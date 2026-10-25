# Branch and merge policy

Fallback only: this repo's own docs and its merged-PR practice win wherever they speak. `main` is
production, advanced only by merging the standing promotion PR. `dev` is the long-lived integration
branch: every feature or fix branch (`<type>/<slug>`) is cut from a fresh `dev` and merges back by
PR, squash commit, by the agent once green. A whole-spec build lands on one integration branch
(`feat/<spec-slug>`) with a draft PR into `dev` that waits for Review and Ship. Promotion is one
standing PR from `dev` into `main`, merge commit (so `main` keeps each item's commit), opened or
refreshed by Ship after each merge into `dev` and merged by the agent once its checks are green,
unless it carries a one-way door no spec or ADR settled: that one waits for the operator. The one
exception: an edit to `docs/plans/next-steps.md` alone commits straight to `dev` and is pushed.

This is a private repo on a free GitHub plan, so GitHub offers no branch protection here. The rules
above hold by convention: no agent pushes to `main` or merges into it outside the promotion PR.
"Green" means `bun run test` and `bun run typecheck` pass, shown in the PR, until CI exists.
