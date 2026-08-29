const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { parseNdjson, processEvents, summarize } = require("./lib/ingest");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.static("public"));

// A body that's too large or malformed should fail cleanly as JSON, not with
// a default HTML error page the frontend can't parse and would hang on.
app.use((err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({ error: "התוכן גדול מדי. כדאי לבחור תמונה קטנה יותר." });
  }
  if (err instanceof SyntaxError) {
    return res.status(400).json({ error: "בקשה לא תקינה." });
  }
  next(err);
});

// In-memory store: pages live only as long as this process runs.
// A deliberate scope cut — see the design note.
const pages = new Map();

// Pulse's event log: the historical sample plus whatever the live beacon sends.
// Same schema throughout, so one ingest model handles both.
let seedEvents = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, "data", "events.ndjson"), "utf8");
  seedEvents = parseNdjson(raw);
} catch (e) {
  console.warn("No data/events.ndjson found — Pulse starts with no history.");
}
const liveEvents = [];

function ipTrunc(req) {
  let ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
  ip = ip.replace("::ffff:", "");
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  return ip || "unknown";
}

const BUILDING_MS = 1400;
const PLACING_MS = 1600;
const FAIL_RATE = 0.3; // ~30% of publishes fail on their own, by design.

function genId() {
  return "p_" + crypto.randomBytes(4).toString("hex");
}

function shouldFail(title) {
  if (title.toLowerCase().includes("fail")) return true; // deterministic trigger for demoing the failure path
  return Math.random() < FAIL_RATE;
}

function advance(id) {
  const page = pages.get(id);
  if (!page) return;

  setTimeout(() => {
    const p = pages.get(id);
    if (!p) return;
    p.status = "placing";

    setTimeout(() => {
      const p2 = pages.get(id);
      if (!p2) return;
      if (shouldFail(p2.title)) {
        p2.status = "failed";
      } else {
        p2.status = "live";
        p2.publishedAt = Date.now();
      }
    }, PLACING_MS);
  }, BUILDING_MS);
}

app.post("/api/publish", (req, res) => {
  const { title, blurb, imageDataUrl } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: "כותרת היא שדה חובה." });
  }

  const id = genId();
  pages.set(id, {
    id,
    title: title.trim(),
    blurb: (blurb || "").trim(),
    imageDataUrl: imageDataUrl || null,
    status: "building",
    createdAt: Date.now(),
    publishedAt: null,
  });

  advance(id);
  res.json({ id });
});

app.get("/api/publish/:id/status", (req, res) => {
  const page = pages.get(req.params.id);
  if (!page) return res.status(404).json({ error: "Unknown page." });
  res.json({ id: page.id, status: page.status, title: page.title });
});

app.post("/api/publish/:id/retry", (req, res) => {
  const page = pages.get(req.params.id);
  if (!page) return res.status(404).json({ error: "Unknown page." });
  if (page.status !== "failed") {
    return res.status(400).json({ error: "Only a failed publish can be retried." });
  }
  page.status = "building";
  advance(page.id);
  res.json({ id: page.id, status: page.status });
});

app.post("/api/beacon", (req, res) => {
  const { event_id, ts, type, reaction, page_id, session_id } = req.body || {};
  if (!event_id || !page_id || !session_id || (type !== "view" && type !== "reaction")) {
    return res.status(400).json({ error: "Malformed beacon event." });
  }
  liveEvents.push({
    event_id,
    ts: ts || new Date().toISOString(),
    type,
    reaction: reaction || null,
    page_id,
    session_id,
    ip_trunc: ipTrunc(req), // derived server-side — the client can't just claim an IP
    ua: req.headers["user-agent"] || "",
  });
  res.status(204).end();
});

const SETTLE_MS = 15000; // no new event on a page for this long => "settled"

app.get("/api/pulse", (req, res) => {
  const cleaned = processEvents([...seedEvents, ...liveEvents]);
  const summary = summarize(cleaned);

  const lastEventAt = {};
  for (const e of cleaned) {
    const t = new Date(e.ts).getTime();
    if (!lastEventAt[e.page_id] || t > lastEventAt[e.page_id]) lastEventAt[e.page_id] = t;
  }

  const now = Date.now();
  const pagesOut = {};
  for (const [pageId, stats] of Object.entries(summary)) {
    const known = pages.get(pageId);
    pagesOut[pageId] = {
      ...stats,
      title: known ? known.title : null,
      liveUrl: known ? `/p/${pageId}` : null,
      settled: now - (lastEventAt[pageId] || 0) > SETTLE_MS,
    };
  }

  // A page can be live on Launchpad with zero visits so far — show it on
  // Pulse right away rather than making it wait for its first event.
  for (const [pageId, page] of pages) {
    if (page.status === "live" && !pagesOut[pageId]) {
      pagesOut[pageId] = {
        rawViews: 0,
        reach: 0,
        botViewsFiltered: 0,
        reactions: { like: 0, heart: 0 },
        botReactionsFiltered: 0,
        duplicateReactionsFiltered: 0,
        title: page.title,
        liveUrl: `/p/${pageId}`,
        settled: true,
      };
    }
  }

  res.json({ pages: pagesOut, eventsIngested: cleaned.length });
});

function simpleNotice(title, body) {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:-apple-system,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#14181F;background:#F4F5F7;text-align:center;}
    .card{background:#fff;border-radius:14px;padding:32px 28px;border:1px solid #DCE0E6;}
    h1{font-size:20px;margin:0 0 8px;}
    p{color:#5B6472;font-size:14.5px;margin:0;}
    a{color:#3557E8;text-decoration:none;font-weight:600;}
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;
}

app.get("/p/:id", (req, res) => {
  const page = pages.get(req.params.id);
  if (!page) {
    return res.status(404).send(simpleNotice("הדף הזה לא קיים", 'ייתכן שהקישור שגוי, או שהשרת הופעל מחדש מאז שהוא פורסם. <a href="/index.html">פרסום דף חדש →</a>'));
  }
  if (page.status !== "live") {
    return res.status(404).send(simpleNotice("הדף עוד לא חי", "עדיין בתהליך פרסום — אפשר לנסות שוב בעוד רגע."));
  }

  res.send(`<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(page.title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:-apple-system,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;line-height:1.6;color:#14181F;background:#F4F5F7;}
    .card{background:#fff;border-radius:14px;padding:28px 30px;border:1px solid #DCE0E6;}
    img{max-width:100%;border-radius:10px;margin-bottom:16px;display:block;}
    h1{margin:0 0 10px;font-size:26px;}
    p{color:#5B6472;font-size:16px;}
    .tag{font-family:ui-monospace,monospace;font-size:11px;color:#3557E8;background:#E4E9FC;padding:3px 9px;border-radius:6px;display:inline-block;margin-bottom:14px;}
    .reactions{display:flex;gap:10px;margin-top:20px;}
    .reactions button{font:inherit;font-size:15px;padding:8px 16px;border-radius:8px;border:1px solid #DCE0E6;background:#F4F5F7;cursor:pointer;}
    .reactions button:disabled{opacity:.5;cursor:default;}
  </style>
</head>
<body>
  <div class="card">
    <span class="tag">Live via Ship &amp; See</span>
    ${page.imageDataUrl ? `<img src="${page.imageDataUrl}" alt="">` : ""}
    <h1>${escapeHtml(page.title)}</h1>
    <p>${escapeHtml(page.blurb)}</p>
    <div class="reactions">
      <button id="likeBtn">👍 לייק</button>
      <button id="heartBtn">❤️ לב</button>
    </div>
  </div>
  <script>
    const PAGE_ID = ${JSON.stringify(page.id)};
    // A fresh session_id every load, on purpose — this is exactly the
    // "session rotates, session ≠ human" behavior Pulse has to see through.
    const SESSION_ID = "s_" + Math.random().toString(36).slice(2, 10);
    function newId(prefix) { return prefix + "_" + Math.random().toString(36).slice(2, 10); }

    function sendBeacon(type, reaction) {
      fetch("/api/beacon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: newId("e"),
          ts: new Date().toISOString(),
          type,
          reaction: reaction || null,
          page_id: PAGE_ID,
          session_id: SESSION_ID,
        }),
      });
    }

    sendBeacon("view");

    // Remembered on this device across reloads, so the button doesn't lie
    // and invite a re-like — the server also dedupes by identity regardless.
    const REACTED_KEY = "reacted_" + PAGE_ID;
    let reacted = !!localStorage.getItem(REACTED_KEY);
    if (reacted) {
      document.getElementById("likeBtn").disabled = true;
      document.getElementById("heartBtn").disabled = true;
    }

    function react(kind) {
      if (reacted) return;
      reacted = true;
      localStorage.setItem(REACTED_KEY, kind);
      document.getElementById("likeBtn").disabled = true;
      document.getElementById("heartBtn").disabled = true;
      sendBeacon("reaction", kind);
    }
    document.getElementById("likeBtn").addEventListener("click", () => react("like"));
    document.getElementById("heartBtn").addEventListener("click", () => react("heart"));
  </script>
</body>
</html>`);
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
