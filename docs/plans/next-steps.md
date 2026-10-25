# Next Steps — conversion-sync

Status board, one line per Issue (⚡ = tracker label `ready-for-agent`, 🧑 = `ready-for-human`); the detail lives on the tracker.

> **Fresh session?** v0 (HubSpot won deal → Meta Purchase event) sits in a PR into `dev`, waiting for review (recipe 3b). Run 🔧 first.

## 🔧 Machine setup — do this FIRST
```sh
bun install
bun run test        # Vitest, all green
bun run typecheck   # tsc --noEmit, no output
```
Before declaring done, run `bun run test && bun run typecheck`.

## ⚡ Agent-ready queue
- [ ] review #2 · src/index.ts:58 — 204 before the sync (waitUntil): a failed Meta/HubSpot call is never retried, the sale is lost.
- [ ] review #2 · src/meta.ts:38 — event_time = closedate: a deal closed >7 days ago or in the future is rejected by Meta on every try.
- [ ] review #2 · src/sync.ts:16 — has() then send() races: two concurrent deliveries both send the same sale.
- [ ] review #2 · README.md:15-16,55 — claims HubSpot retries failed syncs, Meta dedups server events, and test events are harmless; all false.

## 🧑 Human-in-the-loop
- Deploy needs Khoi's Cloudflare account and secrets: `wrangler d1 create`, `wrangler secret put` (HUBSPOT_CLIENT_SECRET, HUBSPOT_TOKEN, META_PIXEL_ID, META_ACCESS_TOKEN). No agent does this.

## Reference — consult when a task needs it
- **Lessons** — one line per trap, newest first:
  - Free private repo: GitHub offers no branch protection; `main` is protected by convention only (ADR 0001).
- Pre-publish review findings for v0 are in the v0 PR body.
