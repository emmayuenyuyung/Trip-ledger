# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

static HTML/CSS/JS with no build step, published on GitHub Pages. GitHub Issues are the write path and the GitHub repository is the datastore; a GitHub Actions workflow rebuilds `data/expenses.json` and the page reads it. Chosen by the user over a hosted backend.

## Users

A small group of friends on one trip — typically three to eight people, unevenly technical — sharing costs over a few days or weeks. They are on a phone, in a restaurant, a hotel lobby, or a taxi queue, right after someone paid for something. Their job: record who paid and for whom, and find out who owes whom, without a spreadsheet or a paid app.

Secondary user: the organiser who creates the repository, fills in the traveller list, and sends the link around.

## Product Purpose

Record shared trip expenses and always answer "who owes whom how much", so the group settles up once at the end without re-deriving anything. Success is a settle-up list that people pay without arguing with it.

## Positioning

The ledger lives in the group's own GitHub repository: an expense is a GitHub Issue, the ledger is a JSON file a workflow rebuilds, and the page is static hosting. No account beyond the one everyone already has, no server to run, no vendor holding the money data. A hosted expense-splitting app cannot copy this because its whole value is the hosting.

## Operating Context

Adding an expense means opening a GitHub Issue through an issue form. The workflow parses every open `expense` issue, rebuilds the ledger, and commits it. Reading the page means fetching two static files from GitHub Pages, mostly on a phone. Correcting an expense means editing its issue; removing one means closing it. Currency rates and the traveller roster are hand-edited in `config.json`.

## Capabilities and Constraints

- Expense fields: payer, amount, currency, description, date, split method, participants.
- Split methods: equal, weighted shares, exact amounts.
- Views: per-expense ledger, per-person net balance, minimal set of settle-up transfers.
- Multi-currency only via manual rates in `config.json`; no live FX feed.
- Read path is eventually consistent: GitHub Pages caches for about ten minutes.
- A public repository is required on the free plan, so everyone's spending is world-readable. Accepted by the user.
- Only open issues carrying the `expense` label count.
- No authentication beyond GitHub, and no write path from the browser.
- Malformed expenses surface as visible problems rather than being silently dropped.

## Evidence on Hand

No real trip data exists yet. The page ships with clearly labelled synthetic demo data so the mechanism is legible before the repository has any expenses; that data must be replaced, and nothing about it should be mistaken for a real trip.

## Product Principles

1. The settle-up number is the product; everything else is bookkeeping that earns its place.
2. Never invent a figure. Every number on screen traces back to an issue.
3. It has to work one-handed, on a phone, in bad light.
4. The repository is the source of truth and the page is a view of it.
5. Fail loudly on a malformed expense rather than silently losing money.

## Accessibility & Inclusion

Readable at small sizes and in sunlight. Who owes whom is never carried by colour alone — sign, glyph, and label carry it too. Fully keyboard reachable. Motion respects `prefers-reduced-motion`.
