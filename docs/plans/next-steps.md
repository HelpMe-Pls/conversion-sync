# Next Steps — conversion-sync

Status board, one line per Issue (⚡ = tracker label `ready-for-agent`, 🧑 = `ready-for-human`); the detail lives on the tracker.

> **Fresh session?** v0 (HubSpot won deal → Meta Purchase event) is shipped to `main`, not deployed. Run 🔧 first.

## 🔧 Machine setup — do this FIRST
```sh
bun install
bun run test        # Vitest, all green
bun run typecheck   # tsc --noEmit, no output
```
Before declaring done, run `bun run test && bun run typecheck`.

## ⚡ Agent-ready queue
- [ ] #5 Destinations: Meta behind a destination seam, sync log per destination (spec #4)
- [ ] #6 Google Ads destination via the Data Manager API — blocked by #5 (spec #4)

## 🧑 Human-in-the-loop
- #7 Decide which consent fields go to Google (legal call). Until then none are sent.
- Spec #4 was planned AFK on 2026-10-25: its Implementation Decisions are the interview's recommended answers. Ratify or change them.
- Deploy needs Khoi's Cloudflare account and secrets: `wrangler d1 create`, `wrangler secret put` (HUBSPOT_CLIENT_SECRET, HUBSPOT_TOKEN, META_PIXEL_ID, META_ACCESS_TOKEN). No agent does this.

## Reference — consult when a task needs it
- **Lessons** — one line per trap, newest first:
  - HubSpot gives a webhook ~5s: the Worker syncs before answering, so keep each delivery small (PR #2).
  - Free private repo: GitHub offers no branch protection; `main` is protected by convention only (ADR 0001).
- v0 review history: PR #2.
- Google Ads research with sources: docs/research-google-ads-offline.md
