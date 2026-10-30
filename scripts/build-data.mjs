#!/usr/bin/env node
/**
 * Turns open GitHub Issues labelled "expense" into data/expenses.json.
 *
 * Runs inside .github/workflows/ledger.yml, where GITHUB_TOKEN and
 * GITHUB_REPOSITORY are already set. Nothing secret is ever shipped to the
 * browser: the page only ever reads the JSON this script writes.
 *
 * Parse failures are collected into `problems` rather than dropped, so a typo
 * in an issue shows up on the page instead of quietly losing somebody's money.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.GITHUB_API_URL || "https://api.github.com";
const REPO = process.env.GITHUB_REPOSITORY || "";
const TOKEN = process.env.GITHUB_TOKEN || "";
const LABEL = "expense";

const METHODS = {
  equal: "equal",
  shares: "shares",
  exact: "exact",
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const config = JSON.parse(await readFile(join(ROOT, "config.json"), "utf8"));
  const roster = Array.isArray(config.travellers) ? config.travellers : [];
  const rosterIndex = new Map(roster.map((name) => [name.toLowerCase(), name]));
  const aliasIndex = new Map(
    Object.entries(config.aliases || {}).map(([alias, target]) => [
      String(alias).trim().toLowerCase(),
      String(target).trim(),
    ]),
  );

  const issues = await fetchExpenseIssues();
  const expenses = [];
  const problems = [];

  for (const issue of issues) {
    try {
      expenses.push(
        parseIssue(issue, {
          rosterIndex,
          aliasIndex,
          rates: config.ratesToBase || {},
        }),
      );
    } catch (error) {
      problems.push({
        issue: issue.number,
        title: cleanTitle(issue.title),
        url: issue.html_url,
        reason: error.message,
      });
    }
  }

  expenses.sort(
    (a, b) => a.date.localeCompare(b.date) || a.issue - b.issue,
  );

  const ledger = {
    generatedAt: new Date().toISOString(),
    demo: false,
    expenses,
    problems,
  };

  await writeFile(
    join(ROOT, "data", "expenses.json"),
    `${JSON.stringify(ledger, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `Ledger rebuilt: ${expenses.length} expense(s), ${problems.length} problem(s).`,
  );
  for (const problem of problems) {
    console.log(`  #${problem.issue} ${problem.title}: ${problem.reason}`);
  }
}

/* ------------------------------------------------------------------ fetch */

async function fetchExpenseIssues() {
  if (!REPO) {
    throw new Error("GITHUB_REPOSITORY is not set");
  }

  const collected = [];
  for (let page = 1; page <= 20; page += 1) {
    const url =
      `${API}/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(LABEL)}` +
      `&per_page=100&page=${page}&sort=created&direction=asc`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "trip-split-ledger",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API ${response.status} for ${url}: ${await response.text()}`,
      );
    }

    const batch = await response.json();
    // The issues endpoint also returns pull requests; they are not expenses.
    collected.push(...batch.filter((item) => !item.pull_request));

    if (batch.length < 100) {
      break;
    }
  }

  return collected;
}

/* ------------------------------------------------------------------ parse */

function parseIssue(issue, refs) {
  const fields = splitSections(issue.body || "");

  const payer = canonicalName(
    value(fields, "who paid", "payer"),
    refs,
    "Who paid",
  );

  const amount = parseNumber(
    value(fields, "amount"),
    "Amount",
  );
  if (amount <= 0) {
    throw new Error(`Amount must be greater than zero, got "${amount}".`);
  }

  const currency = value(fields, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`Currency "${currency}" is not a three-letter code.`);
  }
  if (!Object.prototype.hasOwnProperty.call(refs.rates, currency)) {
    throw new Error(
      `No exchange rate for ${currency} in config.json, so this cannot be counted.`,
    );
  }

  const method = parseMethod(value(fields, "how to split it", "split"));
  const participantBlock = value(fields, "who is splitting it", "participants");
  const participants = parseParticipants(participantBlock).map((name) =>
    canonicalName(name, refs, "Who is splitting it"),
  );

  if (participants.length === 0) {
    throw new Error("Nobody is ticked under “Who is splitting it”.");
  }
  if (new Set(participants).size !== participants.length) {
    throw new Error("The same person is ticked twice under “Who is splitting it”.");
  }

  const details = parseDetails(
    value(fields, "shares or exact amounts", "details"),
  );

  const shares = buildShares(method, participants, details, amount);

  const date = parseDate(
    value(fields, "date"),
    issue.created_at,
  );

  return {
    issue: issue.number,
    title: cleanTitle(issue.title),
    url: issue.html_url,
    date,
    payer,
    amount: round(amount, 4),
    currency,
    method,
    shares,
    category: value(fields, "category") || "Other",
    notes: cleanText(value(fields, "notes")),
  };
}

/** "### Payer" headings, as GitHub renders an issue form. */
function splitSections(body) {
  const sections = {};
  const heading = /^###\s+(.+?)\s*$/gm;
  const heads = [...body.matchAll(heading)];

  for (let index = 0; index < heads.length; index += 1) {
    const key = heads[index][1].trim().toLowerCase();
    const start = heads[index].index + heads[index][0].length;
    const end =
      index + 1 < heads.length ? heads[index + 1].index : body.length;
    sections[key] = body.slice(start, end).trim();
  }

  return sections;
}

function value(sections, ...keys) {
  for (const key of keys) {
    const raw = sections[key];
    if (raw === undefined) continue;
    const text = raw.replace(/_No response_/g, "").trim();
    if (text) return text;
  }
  return "";
}

function cleanText(text) {
  return text
    .replace(/_No response_/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

function cleanTitle(title) {
  return title
    .replace(/^\s*expense\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim() || "Expense";
}

function canonicalName(raw, refs, fieldLabel) {
  const name = cleanText(raw).replace(/^[-*]\s*(\[[ xX]\]\s*)?/, "").trim();
  if (!name) {
    throw new Error(`“${fieldLabel}” is empty.`);
  }
  const key = name.toLowerCase();

  const match = refs.rosterIndex.get(key);
  if (match) return match;

  // Renaming somebody in config.json would orphan every issue that still
  // carries their old name, so old names are mapped through `aliases`
  // instead of editing issues one by one.
  const alias = refs.aliasIndex.get(key);
  if (alias) {
    const resolved = refs.rosterIndex.get(alias.toLowerCase());
    if (resolved) return resolved;
    throw new Error(
      `“${name}” is an alias for “${alias}”, which is not in travellers in config.json.`,
    );
  }

  throw new Error(
    `“${name}” is not one of the travellers in config.json (${fieldLabel}).`,
  );
}

function parseNumber(raw, fieldLabel) {
  const text = cleanText(raw);
  if (!text) {
    throw new Error(`“${fieldLabel}” is empty.`);
  }
  const numeric = text.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const number = Number(numeric);
  if (!numeric || !Number.isFinite(number)) {
    throw new Error(`“${fieldLabel}” is not a number: "${text}".`);
  }
  return number;
}

function parseMethod(raw) {
  const text = raw.toLowerCase();
  if (text.startsWith("equal")) return METHODS.equal;
  if (text.includes("share") || text.includes("weight")) return METHODS.shares;
  if (text.startsWith("exact")) return METHODS.exact;
  throw new Error(
    `Unrecognised split method "${raw}". Use one of the dropdown options.`,
  );
}

function parseParticipants(block) {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s*\[[xX]\]/.test(line))
    .map((line) => line.replace(/^-\s*\[[xX]\]\s*/, "").trim())
    .filter(Boolean);
}

function parseDetails(block) {
  const entries = new Map();
  for (const line of block.split("\n")) {
    const trimmed = line.trim().replace(/^[-*]\s*/, "");
    if (!trimmed) continue;
    const match = trimmed.match(/^(.+?)\s*[:=]\s*(-?[\d.,]+)$/) ||
      trimmed.match(/^(.+?)\s+(-?[\d.,]+)$/);
    if (!match) continue;
    const name = match[1].trim();
    const number = Number(match[2].replace(/,/g, ""));
    if (!name || !Number.isFinite(number)) continue;
    entries.set(name.toLowerCase(), { name, number });
  }
  return entries;
}

function buildShares(method, participants, details, amount) {
  if (method === METHODS.equal) {
    return participants.map((name) => ({ name, value: 1 }));
  }

  const missing = [];
  const shares = participants.map((name) => {
    const entry = details.get(name.toLowerCase());
    if (!entry) {
      missing.push(name);
      return { name, value: 0 };
    }
    if (method === METHODS.exact && entry.number <= 0) {
      throw new Error(`${name} has an exact amount of ${entry.number}.`);
    }
    if (method === METHODS.shares && entry.number <= 0) {
      throw new Error(`${name} has a share of ${entry.number}; it must be positive.`);
    }
    return { name, value: entry.number };
  });

  if (missing.length > 0) {
    throw new Error(
      `“Shares or exact amounts” is missing ${formatList(missing)}.`,
    );
  }

  if (method === METHODS.exact) {
    const sum = shares.reduce((total, share) => total + share.value, 0);
    if (Math.abs(sum - amount) > 0.011) {
      throw new Error(
        `Exact amounts add up to ${round(sum, 2)} but the total is ${round(amount, 2)}.`,
      );
    }
  }

  return shares;
}

function parseDate(raw, createdAt) {
  const text = cleanText(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  if (!text) {
    return (createdAt || new Date().toISOString()).slice(0, 10);
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Date "${text}" is not YYYY-MM-DD.`);
  }
  return parsed.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ util */

function formatList(names) {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function round(number, places) {
  const factor = 10 ** places;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}
