# Next Steps — conversion-sync

Status board, one line per Issue (⚡ = tracker label `ready-for-agent`, 🧑 = `ready-for-human`); the detail lives on the tracker.

> **Fresh session?** Meta and Google Ads destinations are shipped to `main`, not deployed. Run 🔧 first.

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
- #7 Decide which consent fields go to Google (legal call). Until then none are sent.
- Spec #4 was planned AFK on 2026-10-25: its Implementation Decisions are the interview's recommended answers. Ratify or change them.
- Deploy needs Khoi's Cloudflare account and secrets: `wrangler d1 create`, `wrangler secret put` (HUBSPOT_CLIENT_SECRET, HUBSPOT_TOKEN, META_PIXEL_ID, META_ACCESS_TOKEN; for Google GOOGLE_SERVICE_ACCOUNT_KEY plus the account and conversion action ids). Google also needs a Cloud project, the Data Manager API, a service account and an 'Import from clicks' conversion action (README). No agent does this.

## Reference — consult when a task needs it
- **Lessons** — one line per trap, newest first:
  - Only Data Manager's EVENT_TIME_INVALID is permanent ('rejected'); every other Google error stays retryable, so a setup mistake never drops sales (PR #8).
  - HubSpot gives a webhook ~5s: the Worker syncs before answering, so keep each delivery small (PR #2).
  - Free private repo: GitHub offers no branch protection; `main` is protected by convention only (ADR 0001).
- v0 review history: PR #2.
- Google Ads research with sources: docs/research-google-ads-offline.md
