const overviewEl = document.getElementById("overview");
const listEl = document.getElementById("pageList");

// Cards keep a stable position once shown — sorting live by a number that
// keeps changing (reach) would make the whole list jump around every poll.
// New pages just join at the end.
const knownOrder = [];
function stableOrder(pageIds) {
  for (const id of pageIds) {
    if (!knownOrder.includes(id)) knownOrder.push(id);
  }
  return knownOrder.filter((id) => pageIds.includes(id));
}

function esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderOverview(pages) {
  const entries = Object.values(pages);
  const totalReach = entries.reduce((s, p) => s + p.reach, 0);
  const totalRaw = entries.reduce((s, p) => s + p.rawViews, 0);
  const totalFiltered = entries.reduce((s, p) => s + p.botViewsFiltered + p.botReactionsFiltered, 0);

  overviewEl.innerHTML = `
    <div class="stat"><div class="num">${totalReach}</div><div class="lbl">בני אדם ייחודיים, בסה"כ</div></div>
    <div class="stat"><div class="num">${totalRaw}</div><div class="lbl">ביקורים גולמיים</div></div>
    <div class="stat"><div class="num">${totalFiltered}</div><div class="lbl">אירועי בוט שסוננו</div></div>
  `;
}

function renderPages(pages) {
  const orderedIds = stableOrder(Object.keys(pages));

  if (orderedIds.length === 0) {
    listEl.innerHTML = `<p class="empty">עדיין אין נתונים — פרסום דף ב-Launchpad יציג אותו כאן.</p>`;
    return;
  }

  listEl.innerHTML = orderedIds
    .map((pageId) => {
      const p = pages[pageId];
      const dupNote = p.duplicateReactionsFiltered > 0
        ? ` · ${p.duplicateReactionsFiltered} ריאקציה כפולה מאותו אדם סוננה`
        : "";
      return `
      <div class="page-card">
        <div class="page-card-head">
          <div>
            <p class="page-title">${esc(p.title || "דף מ-events.ndjson")}</p>
            <p class="page-id">${esc(pageId)}</p>
          </div>
          <span class="badge ${p.settled ? "settled" : "updating"}">${p.settled ? "התייצב" : "עדיין נכנס"}</span>
        </div>

        <div class="reach-row">
          <span class="reach-num">${p.reach}</span>
          <span class="reach-lbl">בני אדם ייחודיים (reach)</span>
        </div>
        <p class="raw-line">מתוך ${p.rawViews} ביקורים גולמיים · ${p.botViewsFiltered} סוננו כבוטים${dupNote}</p>

        <div class="page-foot">
          <div class="reaction-tally">
            <span>👍 ${p.reactions.like}</span>
            <span>❤️ ${p.reactions.heart}</span>
          </div>
          ${p.liveUrl ? `<a class="page-link" href="${p.liveUrl}" target="_blank">פתיחת הדף ↗</a>` : ""}
        </div>
      </div>
    `;
    })
    .join("");
}

async function refresh() {
  try {
    const res = await fetch("/api/pulse");
    const data = await res.json();
    renderOverview(data.pages);
    renderPages(data.pages);
  } catch (e) {
    // A transient failure here shouldn't nuke the last good render.
  }
}

refresh();
setInterval(refresh, 2000);
