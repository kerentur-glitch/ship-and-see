// Run against the real events.ndjson to sanity-check the model before any UI exists.
// Usage: node scripts/analyze.js

const fs = require("fs");
const path = require("path");
const { parseNdjson, processEvents, summarize } = require("../lib/ingest");

const filePath = path.join(__dirname, "..", "data", "events.ndjson");
const raw = fs.readFileSync(filePath, "utf8");

const rawEvents = parseNdjson(raw);
const cleaned = processEvents(rawEvents);
const summary = summarize(cleaned);

console.log(`Raw lines in file:      ${rawEvents.length}`);
console.log(`After dedupe:           ${cleaned.length}`);
console.log();
for (const [pageId, stats] of Object.entries(summary)) {
  console.log(`Page ${pageId}`);
  console.log(`  raw views:            ${stats.rawViews}`);
  console.log(`  bot views filtered:   ${stats.botViewsFiltered}`);
  console.log(`  trustworthy reach:    ${stats.reach}`);
  console.log(`  reactions (like/heart): ${stats.reactions.like} / ${stats.reactions.heart}`);
  console.log(`  bot reactions filtered: ${stats.botReactionsFiltered}`);
  console.log();
}
