# Ship & See

CloudGrid take-home: **Launchpad** (publish flow) + **Pulse** (impact dashboard).

Live demo: https://ship-and-see.onrender.com
Design note: [DESIGN_NOTE.md](./DESIGN_NOTE.md)

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:3000

## What's here

- `/` — Launchpad: publish a title, blurb, and optional image through a guided flow.
- `/p/:id` — the live published page, carrying the measurement beacon.
- `/pulse.html` — Pulse: reach vs. raw views, reactions, bot/duplicate filtering, live.
- `lib/ingest.js` — the reach model: dedupe, bot filtering, identity-based counting.
- `scripts/analyze.js` — runs the model against the real `data/events.ndjson` standalone.
- `data/events.ndjson` — the sample event stream, loaded as Pulse's starting history.

## Notes for testing

- To reliably see the failure path in Launchpad, include the word "fail" in the title
  (otherwise it fails on its own about 30% of the time).
- Pages published through Launchpad live in memory. A redeploy or an idle restart on
  Render's free tier resets them — this is a deliberate scope cut, explained in the design
  note. `events.ndjson`'s history always reloads, since it's read from disk on startup.
