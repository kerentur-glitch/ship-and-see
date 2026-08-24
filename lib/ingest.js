// Turns a messy, adversarial event stream into trustworthy per-page numbers.
//
// The model, in plain terms:
//   1. De-duplicate by event_id (an event delivered twice must not count twice).
//   2. Sort by timestamp (arrival order is not delivery order).
//   3. Flag bot traffic by known automation signatures.
//   4. Count a "human" as one (ip_trunc, ua) pair among non-bot traffic —
//      an honest proxy, not a perfect one: two real people behind the same
//      NAT on the same browser/OS collapse into one. That limitation is
//      disclosed on the dashboard, not hidden.

const BOT_UA_PATTERNS = [
  /python-requests/i,
  /HeadlessChrome/i,
  /curl\//i,
  /bot|spider|crawler/i,
];

function isBot(ua) {
  return BOT_UA_PATTERNS.some((pattern) => pattern.test(ua));
}

function dedupeById(events) {
  const seen = new Set();
  const deduped = [];
  for (const event of events) {
    if (seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    deduped.push(event);
  }
  return deduped;
}

function parseNdjson(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Cleans a batch of raw events: dedupe, sort by real time, tag bots.
function processEvents(rawEvents) {
  const deduped = dedupeById(rawEvents);
  deduped.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return deduped.map((event) => ({ ...event, isBot: isBot(event.ua) }));
}

// Rolls cleaned events up into the numbers Pulse actually shows.
function summarize(cleanedEvents) {
  const pages = {};

  function pageFor(pageId) {
    if (!pages[pageId]) {
      pages[pageId] = {
        rawViews: 0,
        botViewsFiltered: 0,
        reach: 0,
        reactions: { like: 0, heart: 0 },
        botReactionsFiltered: 0,
        _humanIdentities: new Set(),
      };
    }
    return pages[pageId];
  }

  for (const event of cleanedEvents) {
    const page = pageFor(event.page_id);
    const identity = `${event.ip_trunc}|${event.ua}`;

    if (event.type === "view") {
      page.rawViews += 1;
      if (event.isBot) {
        page.botViewsFiltered += 1;
      } else {
        page._humanIdentities.add(identity);
      }
    }

    if (event.type === "reaction") {
      if (event.isBot) {
        page.botReactionsFiltered += 1;
      } else if (event.reaction === "like" || event.reaction === "heart") {
        page.reactions[event.reaction] += 1;
      }
    }
  }

  const result = {};
  for (const [pageId, page] of Object.entries(pages)) {
    result[pageId] = {
      rawViews: page.rawViews,
      reach: page._humanIdentities.size,
      botViewsFiltered: page.botViewsFiltered,
      reactions: page.reactions,
      botReactionsFiltered: page.botReactionsFiltered,
    };
  }
  return result;
}

module.exports = { isBot, dedupeById, parseNdjson, processEvents, summarize };
