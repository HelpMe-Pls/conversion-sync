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
**Nothing queued.**

## 🧑 Human-in-the-loop
- Deploy needs Khoi's Cloudflare account and secrets: `wrangler d1 create`, `wrangler secret put` (HUBSPOT_CLIENT_SECRET, HUBSPOT_TOKEN, META_PIXEL_ID, META_ACCESS_TOKEN). No agent does this.

## Reference — consult when a task needs it
- **Lessons** — one line per trap, newest first:
  - Free private repo: GitHub offers no branch protection; `main` is protected by convention only (ADR 0001).
- Pre-publish review findings for v0 are in the v0 PR body.
