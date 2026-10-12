# Imagine / XiangXiang development

This is `Louielui/aroma-agent-backend`, the Owner's local assistant. It is not the restaurant production repository. Read `CLAUDE.md`, `docs/HOUSE-RULES.md`, and `docs/AUTONOMOUS-REPOSITORY-PROMOTION.md` before changes. Use absolute paths and verify Git identity.

The Owner pre-authorizes normal low-risk repository promotion under the policy. Do not ask again for ordinary audit, preservation, accepted commits, non-main pushes, tests, independent review, PR creation/update, gated merge, bounded local reload, runtime verification, or exact-source rollback. Recommendations do not authorize new business-system writes or credentials.

Before every tranche run `npm run repo:begin`. Divergence must preserve all unpublished histories and working files, then enter isolated reconciliation; do not continue ordinary promotion. Develop in an isolated non-main worktree. Keep unrelated dirty files accounted for and preserve their exact bytes.

After implementation run `npm run repo:finish -- --files <explicit,comma-separated,accepted,paths> --message <tranche-description>`. This runs the full isolated Node suite, commits only the accepted accounted tree, publishes an exact SHA, retains rollback, creates/updates the PR, independently reviews through Claude subscription, checks remote head/base and review/CI state, merges when all gates pass, then reloads and verifies. Do not substitute a manually written pass receipt. Review subscription usage is recorded; no GPT API fallback is allowed.

Use `npm run repo:status` for the authoritative promotion record. `complete` requires known exact commit, remote preservation, recorded tests/review, PR/merge state, accounted working tree, rollback and measured runtime state. `awaiting_administrator`, `awaiting_idle`, `needs_attention` and `rolled_back` are not completion. Resume only the recorded pending run; never blindly replay effects after an interrupted process.

Owner exceptions are material merge conflict, tests that cannot be safely resolved, security/permission changes, credentials/secrets, destructive migration, business-data writes outside policy, failed rollback, or contradictory runtime state. The current policy does not give the model permission to approve its own exception. Windows service-control delegation is a separately reviewed one-time Owner exception, not an automatic ACL change.

Never force-push main, hard reset, overwrite remote history, or delete the last unique ref. Merge through the PR gate; rollback uses forward history. No new runtime dependencies. Add meaningful failure/regression tests before behavioral changes; run the full suite. Update the in-app architecture status with measured capability and limits.
