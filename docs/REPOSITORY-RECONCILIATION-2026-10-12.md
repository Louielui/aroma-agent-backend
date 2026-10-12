# Repository reconciliation and preservation — 2026-10-12

## Baselines and scope

- Runtime and local main: `1aad4a3b5d5a3a3a37c84fe89e6a655eb19e0ad3`.
- Remote main: `381a8e20b1efe8bc84de5f5d521363e96a1f91f4`.
- Merge base: `cce9f783551622616ce24f276187a77923e5b969`.
- Local-only versus remote main: 243 commits. Remote-only: 27 commits.
- Of the local-only commits, 179 were already reachable from remote feature branches.
- Latest published ancestor on `codex/cost-answer-quality`: `46b3a4aace67bde8e184402c898b769e7f9aa6ec` (October 8).
- Sixty-four runtime-history commits and 45 other historical commits were initially absent from remote refs. These counts describe commit ancestry, not distinct features.

This candidate merges both histories without rewriting either. It does not update local main, remote main, the resident service, credentials, business data, or scheduler state. No runtime cutover is part of this PR.

## Preservation

Nine new remote backup branches preserve all 109 previously unpublished commits:

- `backup/imagine-20261012-runtime-1aad4a3`.
- Eight `backup/imagine-20261012-history-<tip>` branches cover the remaining local branch histories.

An independent local Git bundle preserves all original refs plus a dirty-file checkpoint. The bundle was verified and cloned independently; the binary patch applies cleanly to the original runtime commit. A local manifest records original refs, remote refs, original branch mappings, commit IDs, file hashes and bundle/patch hashes. Credential-shaped pattern screening examined 1,008 newly published blobs with zero findings; this is a screening result, not proof that arbitrary sensitive content cannot exist.

The five pre-existing modified runtime files were copied and hashed before integration. They remain untouched in the running checkout. Four files already match the remote main blobs exactly:

- `src/agent/claudeCodeWorker.js` and its test.
- `src/workers/workspace/tmpdirSandbox.js` and its test.

The remaining `scripts/launcher/xiangxiang-body.ps1` difference is a local model environment assignment. It is preserved in the local checkpoint and binary patch, excluded from this candidate, and is not a new shared default. The local preservation directory and checkpoint are not published as extra production configuration.

## All remote-only non-merge commits

The other eleven remote-only commits are merge-history nodes. All 27 remain ancestors of the merge candidate. No remote commit is dropped or replaced by a force push.

| Commit | Change | Decision |
|---|---|---|
| `88e78c4` | Inert executor retirement proof | Retain; do not wire into production |
| `bb383cc` | Retirement evidence authority | Retain |
| `0be97f4` | WSL execution boundary | Retain |
| `16b278f` | Authoritative OS retirement readers | Retain |
| `1f8f988` | Instance store and inert executor launcher | Retain; do not activate |
| `c1e86a8` | Fail-closed retirement ledger contract | Retain |
| `5b91212` | Fail-closed offline composition root | Retain; do not activate |
| `6b65b86` | Hostile launcher error containment | Retain |
| `1f7ebfa` | Fail-closed ledger coordinator | Retain |
| `b171ac2` | Read-only Claude enquiry hardening | Retain; already present as four dirty runtime files |
| `dd8b6b5` | Preserve completed enquiry evidence when reporting fails | Retain; resolve runner/test conflicts |
| `ab54d42` | Contextual applied-change claim guard | Retain |
| `c0f03ea` | Technical nouns cannot excuse completed-change claims | Retain |
| `cbd4cf3` | Bind descriptive frames and narrow config exception | Retain |
| `085334a` | Bind config resolution frame to its occurrence | Retain |
| `ce1256e` | Correct config-frame documentation | Retain |

## Conflict decisions

| File | Resolution |
|---|---|
| `enquiryRunner.js` | Keep local per-turn diagnostics and remote guarded report assembly/evidence preservation |
| `enquiryRunner.test.js` | Keep existing local tests and add all remote report-failure regressions |
| `enquirySchema.js` | Keep local provider-compatible schema without unsupported array limits; the local validator still enforces the limits |
| `enquirySchema.test.js` | Keep local oversized-payload validation tests |
| `investigationReport.test.js` | Keep local tests and all remote contextual claim-guard regressions |

## Test ledger reconciliation

The first integrated suite caught an assertion that assumed PowerShell would not wrap `A parameter cannot be found`. The test now accepts whitespace wrapping while still requiring a nonzero exit, `NamedParameterNotFound`, and no new listener. No launcher behavior changed.

The worker rewrite changed nine recorded test names. These properties were reviewed before refreshing the ledger:

| Previous property | Current coverage or disposition |
|---|---|
| First round uses `--session-id` | Restored explicit exact-argument test |
| Later rounds resume rather than reopen | Successful dispatch registers resume rights; exact `--resume` and absence of `--session-id` asserted |
| Goal remains one argv entry | Exact hostile-string argv assertion retained |
| Read-only tools | Exact restricted tools and allowed-tools assertions retained |
| Wider grant configurable per call site | Intentionally superseded by a stricter fixed policy: escalation requests are rejected at construction |
| No browser or MCP tool | Explicit no-browser/no-MCP/no-bypass argv assertions retained |
| Unparsable result fails | `refuses no JSON at all` asserts the typed failure |
| Cost and turns preserved | Valid envelope asserts actual cost and turn values |
| Resolver failure keeps its reason | Restored rejection and zero-spawn regression |

No ledger refresh was used to remove a missing safety guarantee silently. Paid/live E2E flags and credentials are removed from the integration test environment; test data is isolated from the Owner's store.

## Runtime capability preservation

Investigation, Action Gateway, capability-gap resolution, 7shifts reads, model routing and usage evidence remain in the candidate. The reconciliation only changes the remote enquiry/OpenClaw surfaces, their tests, the launcher assertion, and the test ledger relative to the saved local runtime commit. The full isolated suite validates their existing fixtures and integration paths. This does not constitute a fresh authenticated external API acceptance or permission to activate OpenClaw.

## Measured validation

- Conflict-focused enquiry, schema, report, worker and sandbox tests: 354 passed.
- Launcher assertion and worker continuity/resolver tests after repairs: 107 passed.
- Refreshed test-name ledger checks: 3 passed.
- Final complete isolated suite: 8,142 tests; 8,137 passed, zero failed, five skipped.
- The first complete run caught the two reconciliation issues described above. Reusing the test data root on a subsequent run exposed retained fixture history; the final run used a new data directory. Failed logs were retained locally, and no application storage behavior was changed to hide the fixture problem.
- Source comparison against `1aad4a3` found no differences in Investigation, Action Gateway, capability-gap core, the 7shifts read adapter, model-router source or usage source.
- The original service stayed running on `1aad4a3`; its service PID and the five preserved file hashes stayed unchanged.

## Review and rollback

Review this candidate against remote main before merging. The original runtime commit and all previous branch histories remain reachable through the backup refs and the local bundle. The running service continues on its original commit with its original five dirty files. A later cutover requires a separate review of that runtime state and the saved launcher override.
