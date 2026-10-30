#!/usr/bin/env node
/**
 * Rewrites the traveller lists in the issue form from config.json.
 *
 * The form is the one place GitHub requires static YAML — an issue form cannot
 * read config.json at runtime — so this script keeps the two in step. Edit
 * `travellers` in config.json and push; the workflow runs this and commits the
 * regenerated form.
 *
 * Both lists live between marker comments, so anything else in the form is
 * left exactly as the author wrote it.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(ROOT, "config.json");
const TEMPLATE = join(ROOT, ".github", "ISSUE_TEMPLATE", "expense.yml");

const INDENT = "        ";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const config = JSON.parse(await readFile(CONFIG, "utf8"));
  const travellers = (config.travellers || [])
    .map((name) => String(name).trim())
    .filter(Boolean);

  if (travellers.length === 0) {
    throw new Error(
      "config.json has an empty travellers list; refusing to blank the form.",
    );
  }

  const seen = new Set();
  for (const name of travellers) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`config.json lists "${name}" twice.`);
    }
    seen.add(key);
  }

  const original = await readFile(TEMPLATE, "utf8");
  let updated = replaceRegion(original, "dropdown", travellers);
  updated = replaceRegion(updated, "checkboxes", travellers);

  if (updated === original) {
    console.log("Issue form already matches config.json.");
    return;
  }

  await writeFile(TEMPLATE, updated, "utf8");
  console.log(
    `Issue form updated with ${travellers.length} travellers: ${travellers.join(", ")}`,
  );
}

function replaceRegion(text, kind, names) {
  const start = `${INDENT}# BEGIN travellers (${kind})`;
  const end = `${INDENT}# END travellers (${kind})`;

  const startAt = text.indexOf(start);
  const endAt = text.indexOf(end);

  if (startAt === -1 || endAt === -1 || endAt < startAt) {
    throw new Error(`Could not find the "${kind}" markers in expense.yml.`);
  }

  const body = names
    .map(
      (name) =>
        `${INDENT}- ${kind === "checkboxes" ? "label: " : ""}${scalar(name)}`,
    )
    .join("\n");

  return (
    text.slice(0, startAt) +
    `${start}\n${body}\n${end}` +
    text.slice(endAt + end.length)
  );
}

/**
 * Plain YAML scalars are fine for ordinary names. Quote anything that could be
 * read as a number, a key, or punctuation.
 */
function scalar(name) {
  if (/^[A-Za-z][A-Za-z0-9 .'’\-]*$/.test(name) && !/\s$/.test(name)) {
    return name;
  }
  return JSON.stringify(name);
}
