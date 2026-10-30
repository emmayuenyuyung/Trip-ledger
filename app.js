/* ==========================================================================
   Trip ledger — reads config.json and data/expenses.json, does the arithmetic
   in the browser, and renders the ledger. No writes, no secrets, no network
   beyond those two static files.
   ========================================================================== */

const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY",
  "KRW",
  "VND",
  "IDR",
  "CLP",
  "ISK",
  "HUF",
]);

const state = {
  config: null,
  data: null,
  model: null,
  sort: { key: "date", dir: "asc" },
  focus: null,
  busy: false,
};

const el = (id) => document.getElementById(id);

const ui = {
  tripName: el("trip-name"),
  tripDates: el("trip-dates"),
  tripPeople: el("trip-people"),
  tripBase: el("trip-base"),
  total: el("total"),
  totalNote: el("total-note"),
  addExpense: el("add-expense"),
  refresh: el("refresh"),
  stamp: el("stamp"),
  loading: el("loading"),
  notice: el("notice"),
  balancesBand: el("balances-band"),
  watermarks: el("watermarks"),
  settleBand: el("settle-band"),
  settleNote: el("settle-note"),
  settle: el("settle"),
  ledgerBand: el("ledger-band"),
  ledgerNote: el("ledger-note"),
  ledgerBody: el("ledger-body"),
  clearFocus: el("clear-focus"),
  problemsBand: el("problems-band"),
  problems: el("problems"),
  repoLink: el("repo-link"),
  footDemo: el("foot-demo"),
  footStamp: el("foot-stamp"),
  main: el("main"),
  table: el("ledger"),
};

boot();

function boot() {
  ui.refresh.addEventListener("click", () => load());

  document.querySelectorAll(".sort").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort = { key, dir: "asc" };
      }
      renderLedger();
    });
  });

  ui.watermarks.addEventListener("click", (event) => {
    const row = event.target.closest(".wm-row");
    if (!row) return;
    const name = row.dataset.person;
    state.focus = state.focus === name ? null : name;
    renderBalances();
    renderLedger();
  });

  ui.clearFocus.addEventListener("click", () => {
    state.focus = null;
    renderBalances();
    renderLedger();
  });

  load();
}

/* ------------------------------------------------------------------ loading */

async function load() {
  if (state.busy) return;
  state.busy = true;
  ui.refresh.disabled = true;
  ui.refresh.textContent = "Refreshing…";

  try {
    if (location.protocol === "file:") {
      throw new Error("file-protocol");
    }

    const [config, data] = await Promise.all([
      readJSON("config.json"),
      readJSON("data/expenses.json"),
    ]);

    state.config = config;
    state.data = data;
    state.model = compute(config, data);

    hide(ui.notice);
    render();
  } catch (error) {
    showFailure(error);
  } finally {
    state.busy = false;
    ui.refresh.disabled = false;
    ui.refresh.textContent = "Refresh";
    ui.loading.hidden = true;
    document.documentElement.dataset.state = "ready";
  }
}

async function readJSON(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

function showFailure(error) {
  const fileProtocol = error.message === "file-protocol";
  const message = fileProtocol
    ? {
        title: "This page needs to be served, not opened from disk.",
        body:
          "Opening index.html straight from your folder blocks the browser from " +
          "reading config.json and the ledger file. Push the folder to GitHub and " +
          "turn on Pages, or run a local server such as " +
          "<code>python -m http.server</code> in the project folder.",
      }
    : {
        title: "The ledger could not be read.",
        body:
          `${escapeHTML(error.message)}. If the repository is new, check that ` +
          "<code>data/expenses.json</code> exists and that the workflow has run once " +
          "in the Actions tab.",
      };

  ui.notice.hidden = false;
  ui.notice.dataset.tone = "warn";
  ui.notice.innerHTML = `<strong>${escapeHTML(message.title)}</strong><p>${message.body}</p>`;
  [ui.balancesBand, ui.settleBand, ui.ledgerBand, ui.problemsBand].forEach(hide);
  ui.total.textContent = "—";
}

/* ------------------------------------------------------------------ compute */

function compute(config, data) {
  const base = config.baseCurrency || "HKD";
  const baseFactor = 10 ** decimals(base);

  const people = new Set(Array.isArray(config.travellers) ? config.travellers : []);
  const paid = new Map();
  const owed = new Map();
  const rows = [];
  const skipped = [];

  for (const expense of data.expenses || []) {
    people.add(expense.payer);
    (expense.shares || []).forEach((share) => people.add(share.name));

    const rate = config.ratesToBase?.[expense.currency];
    const weights = (expense.shares || []).map((share) => share.value);
    const validWeights = weights.length > 0 && weights.every((w) => Number(w) > 0);

    if (typeof rate !== "number" || !validWeights) {
      skipped.push({
        expense,
        reason:
          typeof rate !== "number"
            ? `no exchange rate for ${expense.currency} in config.json`
            : "the split has no positive weights",
      });
      continue;
    }

    const baseMinor = Math.round(expense.amount * rate * baseFactor);
    const allocations = allocate(baseMinor, weights);

    (expense.shares || []).forEach((share, index) => {
      owed.set(share.name, (owed.get(share.name) || 0) + allocations[index]);
    });
    paid.set(expense.payer, (paid.get(expense.payer) || 0) + baseMinor);

    rows.push({
      ...expense,
      baseMinor,
      perHeadMinor: Math.round(baseMinor / weights.length),
    });
  }

  const names = [...people].filter(Boolean);
  const net = new Map(names.map((name) => [name, 0]));
  for (const name of names) {
    net.set(name, (paid.get(name) || 0) - (owed.get(name) || 0));
  }

  const totalMinor = rows.reduce((sum, row) => sum + row.baseMinor, 0);

  return {
    base,
    names,
    net,
    totalMinor,
    rows,
    skipped,
    transfers: settle(net),
  };
}

/** Split an integer amount of minor units so the parts add back up exactly. */
function allocate(totalMinor, weights) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return weights.map(() => 0);

  const exact = weights.map((weight) => (totalMinor * weight) / totalWeight);
  const parts = exact.map((value) => Math.floor(value));
  let remainder = totalMinor - parts.reduce((sum, part) => sum + part, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  let cursor = 0;
  while (remainder > 0 && order.length > 0) {
    parts[order[cursor % order.length].index] += 1;
    remainder -= 1;
    cursor += 1;
  }

  return parts;
}

/** Fewest transfers that clear every balance: biggest debtor pays biggest creditor. */
function settle(net) {
  const debtors = [];
  const creditors = [];

  for (const [name, value] of net) {
    if (value < 0) debtors.push({ name, amount: -value });
    else if (value > 0) creditors.push({ name, amount: value });
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0) {
      transfers.push({ from: debtors[i].name, to: creditors[j].name, amount });
    }
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount === 0) i += 1;
    if (creditors[j].amount === 0) j += 1;
  }

  return transfers;
}

/* ------------------------------------------------------------------- render */

function render() {
  const { config, model, data } = state;

  const trip = config.trip || "Trip ledger";
  document.title = `${trip} · ledger`;
  ui.tripName.textContent = trip;
  ui.tripDates.textContent = config.dates || "";
  ui.tripPeople.textContent = `${model.names.length} travellers`;
  ui.tripBase.textContent = `in ${model.base}`;

  ui.total.textContent = money(model.totalMinor, model.base);

  const perHead = model.names.length
    ? Math.round(model.totalMinor / model.names.length)
    : 0;
  const count = model.rows.length;
  ui.totalNote.textContent = count
    ? `${money(perHead, model.base)} per head · ${count} ${count === 1 ? "expense" : "expenses"}`
    : "Nothing recorded yet";

  ui.stamp.textContent = data.generatedAt
    ? `Ledger rebuilt ${formatStamp(data.generatedAt)}`
    : "";

  ui.footStamp.textContent = data.generatedAt
    ? `Last rebuilt ${formatStamp(data.generatedAt)}`
    : "";

  ui.footDemo.innerHTML = data.demo
    ? ' <span class="demo-flag">Demo data</span>'
    : "";

  const repo = repositoryOf(config);
  if (repo) {
    ui.repoLink.href = `https://github.com/${repo}/issues`;
    ui.repoLink.textContent = repo;
    ui.addExpense.href =
      `https://github.com/${repo}/issues/new?template=expense.yml&` +
      `title=${encodeURIComponent("Expense: ")}`;
    ui.addExpense.hidden = false;
  } else {
    ui.addExpense.hidden = true;
  }

  renderBalances();
  renderSettle();
  renderLedger();
  renderProblems();

  document.getElementById("empty-state")?.remove();

  if (count === 0) {
    renderEmpty(repo);
  } else {
    show(ui.balancesBand);
    show(ui.settleBand);
    show(ui.ledgerBand);
  }
}

function renderBalances() {
  const { model } = state;
  const rows = model.names
    .map((name) => ({ name, net: model.net.get(name) || 0 }))
    .sort((a, b) => b.net - a.net);

  const ceiling = Math.max(1, ...rows.map((row) => Math.abs(row.net)));

  ui.watermarks.innerHTML = rows
    .map((row, index) => {
      const side = row.net > 0 ? "owed" : row.net < 0 ? "owes" : "level";
      const intensity = Math.min(1, Math.abs(row.net) / ceiling);
      const sign = row.net > 0 ? "+" : row.net < 0 ? "\u2212" : "";
      const amount = `${sign}${money(Math.abs(row.net), model.base)}`;
      const tag =
        side === "owed" ? "is owed" : side === "owes" ? "owes" : "even";
      const pressed = state.focus === row.name;

      return `
        <button class="wm-row" type="button" data-person="${escapeHTML(row.name)}"
                data-side="${side}" aria-pressed="${pressed}"
                style="--w:${intensity.toFixed(4)};--delay:${index * 45}ms">
          <span class="wm-name">${escapeHTML(row.name)}</span>
          <span class="wm-scale"><span class="wm-bar"></span></span>
          <span class="wm-amt">${amount}</span>
          <span class="wm-tag">${tag}</span>
        </button>`;
    })
    .join("");
}

function renderSettle() {
  const { model } = state;

  if (model.transfers.length === 0) {
    ui.settleNote.textContent = "Nobody is carrying a balance.";
    ui.settle.innerHTML =
      '<li class="settle-empty">Everyone is square. Nothing to pay back.</li>';
    return;
  }

  ui.settleNote.textContent =
    model.transfers.length === 1
      ? "One payment closes the trip."
      : `${model.transfers.length} payments close the trip.`;

  ui.settle.innerHTML = model.transfers
    .map(
      (transfer) => `
      <li aria-label="${escapeHTML(
        `${transfer.from} owes ${transfer.to} ${money(transfer.amount, model.base)}`,
      )}">
        <span class="settle-pair">
          <span class="settle-who">${escapeHTML(transfer.from)}</span>
          <svg class="settle-arrow" width="18" height="10" viewBox="0 0 18 10" aria-hidden="true" focusable="false">
            <path d="M0 5h16M12 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4"/>
          </svg>
          <span class="settle-who">${escapeHTML(transfer.to)}</span>
        </span>
        <span class="settle-amt">${money(transfer.amount, model.base)}</span>
      </li>`,
    )
    .join("");
}

function renderLedger() {
  const { model } = state;
  const visible = state.focus
    ? model.rows.filter(
        (row) =>
          row.payer === state.focus ||
          (row.shares || []).some((share) => share.name === state.focus),
      )
    : model.rows;

  const sorted = [...visible].sort((a, b) => {
    const direction = state.sort.dir === "asc" ? 1 : -1;
    if (state.sort.key === "amount") {
      return (a.baseMinor - b.baseMinor) * direction;
    }
    return (
      (a.date.localeCompare(b.date) || a.issue - b.issue) * direction
    );
  });

  document.querySelectorAll(".ledger thead th").forEach((th) => {
    const button = th.querySelector(".sort");
    if (!button) return;
    if (button.dataset.sort === state.sort.key) {
      th.setAttribute(
        "aria-sort",
        state.sort.dir === "asc" ? "ascending" : "descending",
      );
    } else {
      th.setAttribute("aria-sort", "none");
    }
  });

  if (state.focus) {
    ui.clearFocus.hidden = false;
    ui.clearFocus.textContent = `Only ${state.focus} \u00d7`;
  } else {
    ui.clearFocus.hidden = true;
  }

  ui.ledgerNote.textContent = state.focus
    ? `${visible.length} of ${model.rows.length} lines · ${money(
        visible.reduce((sum, row) => sum + row.baseMinor, 0),
        model.base,
      )}`
    : `Every line in the ledger. Select a name above to narrow this down.`;

  if (sorted.length === 0) {
    ui.ledgerBody.innerHTML =
      '<tr><td colspan="6" style="padding:1.6rem 0;color:var(--ink-3)">No lines for this traveller.</td></tr>';
    return;
  }

  ui.ledgerBody.innerHTML = sorted
    .map((row) => {
      const split = splitLabel(row);
      // On an equal split this is what each person actually pays; on a weighted
      // or exact split it is only the average, so say so rather than imply
      // a per-person figure that nobody owes.
      const perHead = `${row.method === "equal" ? "" : "\u2248"}${money(
        row.perHeadMinor,
        model.base,
      )}`;
      const notes = row.notes
        ? `<span class="note">${escapeHTML(row.notes)}</span>`
        : "";

      return `
        <tr>
          <td class="date"><time datetime="${escapeHTML(row.date)}">${formatDay(row.date)}</time></td>
          <td>
            <a class="title" href="${escapeHTML(row.url)}" target="_blank" rel="noopener">${escapeHTML(row.title)}</a>
            ${notes}
            <span class="row-sub">Paid by ${escapeHTML(row.payer)} · ${escapeHTML(split)}</span>
          </td>
          <td class="col-who">${escapeHTML(row.payer)}</td>
          <td class="col-num amount">${formatMajor(row.amount, row.currency, true)}</td>
          <td class="col-split split-label">${escapeHTML(split)}</td>
          <td class="col-num col-share per-head">${perHead}</td>
        </tr>`;
    })
    .join("");
}

function renderProblems() {
  const problems = state.model.skipped.map((entry) => ({
    issue: entry.expense.issue,
    title: entry.expense.title,
    url: entry.expense.url,
    reason: entry.reason,
  }));

  const fromServer = (state.data.problems || []).map((problem) => ({
    issue: problem.issue,
    title: problem.title,
    url: problem.url,
    reason: problem.reason,
  }));

  const all = [...fromServer, ...problems];

  if (all.length === 0) {
    hide(ui.problemsBand);
    return;
  }

  show(ui.problemsBand);
  ui.problems.innerHTML = all
    .map(
      (problem) => `
      <li>
        <span class="issue-no">#${problem.issue}</span>
        <a class="issue-title" href="${escapeHTML(problem.url)}" target="_blank" rel="noopener">${escapeHTML(
          problem.title,
        )}</a>
        <span class="issue-reason">${escapeHTML(problem.reason)}</span>
      </li>`,
    )
    .join("");
}

function renderEmpty(repo) {
  [ui.balancesBand, ui.settleBand, ui.ledgerBand].forEach(hide);

  const existing = document.getElementById("empty-state");
  if (existing) existing.remove();

  const block = document.createElement("section");
  block.className = "empty";
  block.id = "empty-state";
  block.innerHTML = `
    <h2>No expenses yet.</h2>
    <p>
      The ledger is empty because no open issue carries the <code>expense</code> label.
      The first one takes about twenty seconds.
    </p>
    <ol>
      <li><span><strong>Open an expense issue.</strong> A form asks for the payer, the amount,
        the currency, and who shares it.</span></li>
      <li><span><strong>Let the workflow run.</strong> It rewrites <code>data/expenses.json</code>
        and republishes this page, usually within a minute.</span></li>
      <li><span><strong>Read the answer.</strong> Watermarks and settle-up appear here the
        moment the first expense lands.</span></li>
    </ol>
    ${
      repo
        ? `<a class="btn btn-primary" style="background:var(--signal);color:var(--ink)"
             href="https://github.com/${repo}/issues/new?template=expense.yml&title=${encodeURIComponent(
               "Expense: ",
             )}" target="_blank" rel="noopener">Open the first expense</a>`
        : `<p>Set <code>repository</code> in <code>config.json</code> to your
             <code>owner/name</code> so this page can link to the issue form.</p>`
    }`;

  ui.main.insertBefore(block, ui.balancesBand);
}

/* ------------------------------------------------------------------ helpers */

function repositoryOf(config) {
  if (config.repository) return config.repository;

  const host = location.hostname;
  if (host.endsWith(".github.io")) {
    const owner = host.split(".")[0];
    const segment = location.pathname.split("/").filter(Boolean)[0];
    return segment ? `${owner}/${segment}` : `${owner}/${owner}.github.io`;
  }

  return null;
}

function decimals(code) {
  return ZERO_DECIMAL_CURRENCIES.has(String(code).toUpperCase()) ? 0 : 2;
}

function money(minor, code) {
  return formatMajor(minor / 10 ** decimals(code), code);
}

function formatMajor(value, code, asCode = false) {
  const digits = decimals(code);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      currencyDisplay: asCode ? "code" : "symbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(digits)}`;
  }
}

function formatDay(iso) {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatStamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function splitLabel(row) {
  const count = (row.shares || []).length;
  if (row.method === "shares") return `${count} weighted`;
  if (row.method === "exact") return `${count} exact`;
  return `${count} ways`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function hide(element) {
  element.hidden = true;
}

function show(element) {
  element.hidden = false;
}
