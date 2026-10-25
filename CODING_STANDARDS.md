# Coding standards

Read at review and by retro. The repo's own docs win wherever they speak; these rules fill the gaps.

## Git hygiene
- Branch and merge policy: `docs/adr/0001-git-flow.md`.
- Commit per green slice with an imperative message; no WIP noise — the branch history reads as the story of the item.
- A PR body follows the `pr` skill: Summary (the smallest visual that shows the change), Evidence (before/after), Merge Danger (one-way or two-way door, plus blast radius).
- Merge or rebase conflicts: trace each hunk's two sides to their primary sources (commit, PR, Issue), keep both intents where compatible, name the trade-off where not, re-run the checks — never resolve by `--ours`/`--theirs` or `--abort` blind.
- Merged branches are deleted; stale branches are debt — prune on sight, except the long-lived branches the git-flow ADR names and `prototype/*` branches, kept as evidence. Never rewrite `main`'s history.

## Tests
- A test exists to catch a REGRESSION: it locks an observable behavior at a seam, reads like a specification, and survives refactors. If internals can change and the test breaks anyway, it was testing implementation — rewrite it at the seam or delete it.
- Test at the HIGHEST seam that reaches the behavior, preferring existing seams — the interface is the test surface. New seams are agreed in the spec before code; the ideal number of new seams is one.
- Minimal suite: one test per behavior/decision. A shared helper's contract is tested once at its own seam, never re-driven per call site. Assert on the thing, never a proxy for it.
- Noise is a defect: no whole-tree snapshots, no mock-wiring or call-count assertions, no styling/copy checks — unless that exact detail IS a locked decision (then record it as an ADR and say so in the test name). Mocks only at system boundaries (external APIs, time, randomness), never around our own modules.
- Expected values come from an independent source (a known literal, the spec), never recomputed the way the code computes them. Browser/end-to-end tests come after the behavior works, never first.
- Every test earns its place by failing for exactly one reason someone cares about. Before cutting a test, read its name for the decision it locks.
- Intermittent ≠ rare: rerun (--repeat-each or equivalent) before declaring a bug disproved or a fix proven; wait out the product's own debounces instead of retrying lookups.
