# Design Note — Ship & See

## What I built, and what I cut

I built both surfaces and connected them into one working loop. Launchpad walks you through
publishing a title, a blurb, and an optional image, moves through real `building → placing →
live` states, and ends with a shareable URL. Every page it publishes carries a small beacon
that reports views and reactions back into Pulse, which turns that raw stream into a reach
number I'm comfortable standing behind, and keeps it clearly separate from the raw pageload
count.

A few things I left out on purpose. I didn't support uploading a raw HTML file for Launchpad,
only title/blurb/image — sanitizing someone else's markup well enough to safely inject a
beacon into it felt like real work for very little payoff here. I also kept storage in memory
on a single long-running server rather than adding a database. The brief allows that
explicitly, but the tradeoff is real: I hit it myself while testing, when a redeploy wiped a
page I'd just published. Given more time, that's the first thing I'd fix. I also chose plain
polling over WebSockets for Pulse — it feels just as live, for a lot less to build. And there's
no login or accounts; it's one shared, anonymous publish flow, matching the scope of the ask.

## Why I'd trust the Pulse number, and how I'd defend it

The core idea is simple: dedupe by `event_id` so a re-delivered event can't double-count, sort
by the actual timestamp rather than arrival order, filter out known bot signatures, and count
a "human" as one distinct (IP, user-agent) pair among whatever's left. I want to be upfront
that this last part is a proxy, not a perfect identity — two real people behind the same
router on the same browser and OS would look like one person to this model. I'd rather say
that plainly than let the number look more precise than it is.

I didn't take this on faith — I ran it against the real `events.ndjson` you gave me. Of 78
lines, 72 survive deduping. Of those, 62 turned out to be bots: one script alone generated 47
pageloads from a single IP, spreading itself across 43 different rotating session IDs to look
like 43 different people. What's left is 3 real, distinct humans across both pages, out of 67
raw pageloads. That gap between the two numbers is really the whole exercise.

Testing my own loop also caught something I'd missed: reactions were filtered for bots but not
deduped by identity, so refreshing and hitting "like" again would have quietly inflated the
count. I fixed it to use the same identity check as reach, and checked it by hand — two "like"
events from the same identity, with different session IDs the way a refresh would look, now
collapse into one, with the duplicate reported rather than hidden.

I don't think any beacon-based system is fully safe from someone hitting the ingest endpoint
directly with faked headers, and I'd rather say that than oversell what I built. What I have is
layered, not airtight: signature-based bot filtering and identity-based deduping on both views
and reactions, plus a dashboard that never presents raw views as if they were reach. The next
layer I'd add is watching for unusual request rates per identity — a UA string is trivial to
fake, but a convincingly human pace is a lot harder.

## How Launchpad fails, and how someone recovers from it

I modeled three states — building, placing, live — each backed by an actual timed transition
on the server, not a spinner standing in for one. The client polls for real status, so it can
never tell someone their page is live before it actually is. Failure is guaranteed to happen:
about 30% of the time on its own, and reliably on demand if the title contains the word "fail,"
so it's easy to show without waiting around for bad luck.

When it fails, the screen says plainly that something went wrong and that nothing they wrote
was lost, then offers two ways forward: a primary "Try again," which retries the exact same
content, and a secondary "Edit details," which returns them to the form filled back in —
including a small thumbnail of the image they'd already chosen, since a browser won't silently
refill a file picker on its own. No error code, no stack trace, anywhere on that screen.

## Where AI helped, and where I overrode it

I built this working with Claude Code, which wrote nearly all of the implementation from
directions I gave one step at a time. My part was steering it and checking its work against
something real — real data, a real browser — before moving on, rather than trusting a
description of what it had done. The clearest override: its first pass at the reach model
treated reactions like any other event, with no identity check. I only noticed because I
published a page myself, liked it, refreshed, and watched the button unlock again like nothing
had happened. That meant the number could be inflated by something as simple as a refresh, so
I pushed for the same identity-based dedupe already used for views, and confirmed the fix with
a direct test before calling it done.

## What I'd build next, given another week

Real persistent storage, so a published page survives a restart — the most immediate gap
today. A second layer of bot detection based on request pace rather than just UA strings,
since the latter is easy to fake. And a visible confidence indicator next to the reach number,
so it's clear at a glance how much of the raw traffic was filtered out to produce it.
