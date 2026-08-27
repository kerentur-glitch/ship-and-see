# Design Note — Ship & See

## What did I build, and what did I deliberately cut?

I built both surfaces end to end and connected them: **Launchpad** takes a title, a blurb,
and an optional image through a guided flow, moves through real `building → placing → live`
states, and ends in a shareable URL. Every published page carries a beacon that reports
views and reactions into **Pulse**, which turns the raw event stream into a reach number I'd
defend, distinguishing it from raw pageloads.

Deliberate cuts:
- **No raw-HTML upload for Launchpad**, only title/blurb/image. Safely sanitizing arbitrary
  third-party markup to inject a beacon into it is real work with little payoff for a demo.
- **In-memory storage on one long-running process** (Render, not serverless — serverless
  would reset state on every request). Explicitly allowed by the brief; the real tradeoff is
  that a redeploy or idle-timeout restart wipes any page published through Launchpad, though
  the seeded `events.ndjson` history always reloads from disk. I hit this myself while testing
  and decided it wasn't worth solving this week.
- **Polling instead of WebSockets** for Pulse (every 2s) — same felt liveness, less machinery.
- **No accounts or auth** — one shared, anonymous publish flow.

## Pulse: why can the number be trusted, and how would I defend it?

The model: dedupe by `event_id` (idempotent ingest), sort by real timestamp (not arrival
order), flag known bot signatures, and count reach as **distinct (ip_trunc, ua) pairs among
non-bot traffic** — an honest proxy, not a perfect one (two real people behind the same NAT
on the same browser/OS collapse into one; I say so rather than hide it).

Validated against the real `events.ndjson`: 78 lines → 72 after dedupe → 62 of those
bot-generated (one UA alone produced 47 pageloads across 43 rotating `session_id`s from a
single IP) → **3 trustworthy humans total**, out of 67 raw pageloads. That gap is the point.

While testing my own live loop I found a real hole: reactions were deduped by bot UA but not
by identity — refreshing and re-liking inflated the count. Fixed to use the same identity key
as reach, and verified directly: two "like" beacons from the same identity with different
`session_id`s now collapse to one, with the duplicate reported, not hidden.

No beacon-based system is airtight against someone hitting the ingest endpoint directly with
spoofed headers. The defense is layered, not absolute — signature filtering, identity dedup on
views *and* reactions — and, just as important, the dashboard never states raw views as reach;
it shows both, labeled honestly. The next layer I'd add: a rate-anomaly signal per identity,
since a UA string is trivial to fake but request cadence is harder to fake convincingly.

## Launchpad: which states did I model, and how does failure recovery work?

`building → placing → live`, each a real timed server-side transition, polled by the client —
the UI can never claim "live" before the server does. Failure is guaranteed: a ~30% random
chance, plus a deterministic trigger (the word "fail" in the title) so it can be demonstrated
on demand. On failure, the screen states plainly that something went wrong, confirms nothing
was lost, and offers two proportionate actions: a primary **Try again** (retries the same
content) and a secondary **Edit details** (returns to the form pre-filled — including a real
thumbnail of the previously chosen image, since browsers can't silently refill a file input).
No error codes, no stack traces.

## How did I use AI, and where did I override it?

I built this pairing with Claude Code, which wrote essentially all of the implementation from
direction I gave step by step — I tested each piece against real data or in a real browser
before moving on, rather than trusting it by description. The clearest override: the first
pass of the reach model counted reactions like any other event, with no identity dedup. I only
caught it by clicking "like," refreshing, and watching the button unlock again — then pushed
for the same identity-based dedup already used for views. A real gap in the model's internal
consistency, not a cosmetic bug, and it's now fixed and directly tested.

## Given another week, what would I build next?

Persistent storage (SQLite or Postgres) so published pages survive a restart — the most
immediate real gap today. A rate-anomaly signal as a second bot-detection layer beyond UA
matching. Real-time push instead of polling, and a visible confidence indicator on reach
reflecting how much traffic was filtered out to produce it.
