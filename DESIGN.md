# Design

The world is a **tide table**: a printed reference sheet someone carries to read
a body of water. Ruled columns, figures set in a tabular grid, a single datum line
that every value is read against, and two inks doing all the work.

It is a document, not a dashboard. Cards are avoided; sections are separated by
hairlines the way a table's rows are. The one piece of theatre is the watermark
scale, which is also the most useful thing on the page.

## Palette

Two inks and one signal colour. Nothing else.

| Token | Value | Role |
| --- | --- | --- |
| `--paper` | `#edf0ee` | The ground. Cool off-white, never cream. |
| `--ink` | `#0b1f26` | Body text and rules. |
| `--ink-3` | `#54686e` | Secondary notes. 5.2:1 on paper. |
| `--shell` | `#0a1c22` | The masthead field. |
| `--signal` | `#e2622f` | Primary action, sort state, accent rule. |
| `--owed` | `#b23a1e` | High water: the group owes this person. |
| `--owes` | `#1c5f73` | Low water: this person owes the group. |

`--owed` and `--owes` are never the only carrier of meaning: the amount always
carries a `+` or `−`, and the tag reads *is owed* / *owes*.

## Type

System UI stack only — an Operate surface earns a workhorse face, and a webfont
would be one more thing to load in a taxi queue. Character comes from scale,
tracking and case instead:

- Trip name: `clamp(2rem, 5.2vw, 3.15rem)`, weight 620, tracking `-0.035em`,
  line-height 0.98. This is the only place that scale appears.
- Body: 1rem / 1.55.
- Table headers: 0.705rem, uppercase, tracking `0.085em`, `--ink-3`.
- Every figure uses `font-variant-numeric: tabular-nums`. Columns of numbers align
  or the whole conceit collapses.

## Layout

- One column, max 68rem, generous side padding. No sidebar, no card grid.
- Sections stack: masthead → watermarks → settle up → ledger → needs fixing.
  The order answers the question first and shows the evidence second.
- Rules, not containers. A section is a heading, a note in the margin, and a
  hairline.
- Below 780px the masthead stacks, the ledger drops *Paid by*, *Split* and
  *Per head* into a subline under each title, and the watermark tag is hidden
  because the sign already carries it.

## The signature move

The watermark scale. Every balance is drawn as a bar leaving a shared centre line:
right and vermilion for money owed to you, left and teal for money you owe. Bars
are scaled to the largest absolute balance so the shape of the group is readable
at a glance. Selecting a name filters the ledger to the lines that person is on.

Bars grow from the centre line on load, 520ms, staggered 45ms, exponential
ease-out. `prefers-reduced-motion` removes it entirely.

## States

- **Empty**: not an illustration. A heading, one sentence of explanation, and the
  three steps to the first expense.
- **Needs fixing**: issue number, title, and the exact reason the parser gave.
  These rows are excluded from totals, which is why they are loud.
- **Error**: says whether the file or the server failed, and what to do.
- **Demo data**: a chip in the footer, so synthetic rows are never mistaken for a
  real trip.

## Rules that keep it coherent

- No cards, no nested containers, no shadows. Depth is a hairline.
- No gradients, no glass, no coloured left borders.
- Colour never carries meaning alone.
- Numbers are right-aligned and tabular, always.
- The signal colour appears on: the primary button, the masthead's bottom rule, a
  sorted column's arrow, and the filter chip. Nowhere else.
