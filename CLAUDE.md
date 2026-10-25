# conversion-sync

A Cloudflare Worker that sends HubSpot won deals to ad platforms as conversions: Meta's Conversions API and Google Ads (Data Manager API). TypeScript, D1, Vitest, Bun.

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## The work spine — `docs/plans/next-steps.md` (work) + `docs/adr/` (decisions)
- Read the spine first and run its 🔧 section before any work. ⚡ = agent-ready work (tracker label `ready-for-agent`); 🧑 = operator-only (`ready-for-human`). The tracker holds each Issue's detail; the spine mirrors it, one line per Issue.
- Keep the spine current as you work, never at the end: check off or delete what ships (git log is the record), add surfaced work as one-line ⚡ items linking their Issue or PR, record traps as one-line lessons under Reference. Keep it minimal; commit it per the git-flow ADR.
- A blocked item → park it under 🧑 with the blocker named and continue with the rest.
- A fork that is ADR-worthy (hard to reverse, surprising without context, a real trade-off) or a product-intent call → if it blocks the whole run, stop: options + a recommendation, filed as a 🧑 line; wait for the operator, never guess it. Otherwise park it under 🧑 with the reason and continue.
- Hard-to-reverse decisions are numbered ADRs in `docs/adr/` (format: the `domain-modeling` skill's ADR-FORMAT), never spine lines; read `docs/adr/` before re-opening a settled call. A decision awaiting the operator keeps `status: proposed` plus its 🧑 line.
- Pointers — git flow: `docs/adr/0001-git-flow.md` · review rules: `CODING_STANDARDS.md` · project words: `GLOSSARY.md`. Read them when the task needs them; never restate them.
- `main` is production: it moves only through the standing promotion PR, merged per the git-flow ADR; never bypass branch protection (no `--admin`), never force-push a shared branch. At most 12 subagents per run, 20 as the hard cap.
