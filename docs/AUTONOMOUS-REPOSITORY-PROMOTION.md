# Autonomous Repository Promotion Policy v1

Owner authorization: 2026-10-12. Policy ID: `autonomous-repository-promotion-v1`.

## Scope and authority

Normal low-risk development of `Louielui/aroma-agent-backend` is pre-authorized. The repository identity, runtime common Git directory, remote URL and local service are checked, not inferred from the project folder name. The restaurant production system, financial/business writes, database migrations, credentials, new permission grants and other services are outside automatic scope.

The host coordinator owns repository credentials. It is not registered as a general model tool or arbitrary shell capability. Accepted in-app development is validated against the existing Owner-approved registered work order, exact source/result hashes, independent sandbox receipt and review. A detached fixed driver receives only the exact work-run UUID. No historical job is automatically backfilled at startup; no idle polling starts model calls.

## Preflight and preservation

`repo:begin` and the actual registered-work preparation check branch, local HEAD, live remote refs, origin/main, working files, unpublished commits, ahead/behind/divergence, remote reachability and observed runtime SHA. Stale tracking refs are refreshed without force or pruning. Missing/contradictory facts cannot become zero or pass.

Before development/promotion, all original refs and dirty tracked/untracked source files are preserved in an external hashed manifest, binary patch, exact file copies, private checkpoint and verified Git bundle. Newly unpublished branch histories are screened and pushed to new non-main backup refs with read-back. Credential-shaped content blocks publication; protected config, credentials and business stores are not copied into public branches. Private dirty checkpoints remain deliberately local and are distinguished from unpublished public history.

When repository/remote identity is proven but runtime SHA disagrees, preflight still preserves unpublished history and dirty files before blocking promotion. The post-commit hook therefore cannot strand a new local commit merely because the old process has not reloaded. A stale base (even behind-only) cannot be tested as if it were current. A generated, conflict-free candidate with MERGE_HEAD exactly matching live origin/main is recognized for normal finish; it does not recursively create further worktrees. The development instructions require automatic continuation in that candidate, preserving unrelated overlays and carrying only accepted changes. Divergence first preserves history and then creates a separate reconciliation worktree. Material conflicts remain visible; no ours/theirs blanket resolution, reset, force push or branch deletion is permitted. The integration candidate retains both histories and must pass the same tests/review gates.

Low-risk automatic paths are explicit: the five existing chat/sidebar assets, catalogue/departments presentation, contextResult, ordinary documentation and non-protected tests. Unknown backend paths, adapters/store, launcher/subscription scripts, dependency metadata, workflows and governance files require an Owner scope/security exception. Added executable lines feed the content gate for new write verbs and destructive SQL. The two protected repository protocol adapters cover pre-authorized GitHub PR mutations and an unauthorized-intake smoke probe; edits to either still require the security exception and independent review.

## Normal tranche sequence

1. Preflight and preserve.
2. Account for the complete accepted working tree; stage only explicit accepted paths.
3. Run the full suite with fresh data/artifact roots, credential-free environment and paid E2E disabled.
4. Verify the staged tree and parent have not changed; commit the tested tree.
5. Screen newly published objects; push to a non-main branch and verify exact SHA.
6. Keep the prior runtime commit remotely reachable and its overlays/checkpoint restorable.
7. Create/update the PR and independently review exact candidate SHA/tree/diff through Claude subscription.
8. Check security/permission findings, exceptions, material conflicts, unresolved review threads, external CI and exact head/base. GitHub reviews/statuses/check-runs are paginated with bounded completeness checks; comments cannot erase a changes-requested decision.
9. Merge through GitHub with exact head SHA; verify the resulting tree equals the tested tree.
10. Require idle witnesses, fast-forward the local runtime, retain/reapply accounted overlays, restart only the existing service/owned bridge, and verify backend/bridge SHA, authentication fence and isolated regression tests.

Five existing skips are explicitly named in policy: four paid E2E tests and the existing observer refusal test. Any new/missing/renamed skip, missing count, nonzero failure or cancelled test blocks promotion. Fixtures and mocks are identified as such; test results are not authenticated external business API acceptance.

## Review evidence

Review uses the exact saved running-source checkpoint as the executable baseline. This accounts for old dirty worker/sandbox changes already in the live source and prevents an old GitHub main from being mistaken for the current runtime. The full diff hash, changed-file inventory, candidate commit/tree, reviewed baseline, actual model and usage receipt are recorded. Executable diffs and protected governance instructions are sent in full bounded batches. Unknown/quoted paths fail closed into review; test-like directory names and non-test suffixes cannot suppress review or content scanning. exact *.test.js/*.test.cjs/*.test.mjs and *.e2e equivalents plus ordinary Markdown are inventoried separately and not silently described as line-reviewed. Oversized/unreadable scope, missing model, invalid structured result, findings or negative regression verdict stops promotion. The model cannot create an Owner exception from review prose. The review packet includes the authenticated host authorization and exact retained runtime overlays. GitHub status contexts are publication of host-measured receipts, not independent CI attestations; the separate Actions check validates policy contracts. Full Windows tests and independent Claude review are verified again from their exact local evidence before merge. This policy trusts the Owner host; it does not claim to defend against a malicious Windows Owner who can replace code or GitHub credentials.

The pre-existing CLAUDE_CHAT_MODEL launcher override is machine-local: its canonical launcher blob is unchanged, and its exact saved overlay is restored before restart. Its absence from a diff against a dirty checkpoint is not a new model-default change.

The October reconciliation was reviewed with Claude Sonnet 5.5, 8,137 passed / zero failed / five recorded skips, and merged as PR #65 at `04d12287c3e8e18edbee1df8325682bc59f674b3`. Both histories and all nine backup branches were retained; runtime cutover is a separately measured stage of this delivery.

## Exceptions and Windows control

The exact-commit Owner entry is documented in `DEPLOYMENT-OWNER-ENTRY.md`. An
already committed candidate can start a new workflow only after original exact
test/review evidence and current readiness are revalidated, and separate sealed
scope, Hold-release and deployment decisions are consumed through the existing
Action Gateway. The interactive Owner-host entry cannot import an exception/pass
receipt or accept a model response as consent. A plain exception callback is no
longer a coordinator input. The default gateway remains disconnected; no model
tool or bridge route is enabled. Failed runs remain immutable evidence, not
resumable input. Inspect mode makes no approval or publication.

Only Owner-bound exceptions can authorize material conflicts, unresolved test failures, security/permission changes, credentials, destructive migrations, business-data writes outside scope, failed rollback or contradictory runtime facts. CLI input cannot supply a shell command, pass receipt, model-selected service, repository or exception approval.

Windows may deny service control independently of policy. The reload helper checks the effective start/stop access and does not bypass UAC, create an elevated scheduled task, copy credentials, grant rights or kill a broad process tree. A separately approved permission plan can add only `SERVICE_START|SERVICE_STOP` (`0x30`) for the interactive Owner SID on the existing `AromaXiangXiangBackend` service. It retains the original descriptor, reconstructs the exact change, compares before/read-back state and supports revocation. It grants no change-config, delete, write-DACL, other-service or global administrator right. Plans retain all descriptor sections; the elevated native setter explicitly writes only DACL_SECURITY_INFORMATION (0x4), preserving owner/group and audit/SACL even if sdshow omits hidden audit data. [Microsoft security-information flags](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-setserviceobjectsecurity). [Microsoft service access rights](https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights).

The elevated permission command requires an explicit Owner-approved SHA256 of the complete plan file. Flipping a user-writable boolean is insufficient; a changed plan is rejected before ACL write. An elevated descriptor read can expose audit/SACL omitted from the original unelevated read: compare the exact approved DACL, then separately verify that the observed owner/group/audit sections remain unchanged after the DACL-only write. Additional audit visibility is not permission drift and is never permission to replace audit data. The bridge reload binds a process handle to the initially verified instance, then re-resolves the listener and checks Owner, script, parent and creation time after service restart. Disappearance or a verified replacement is not killed; exit races are contained. The full Windows suite drives the actual helper functions with guarded process fixtures.

No permission plan is applied merely because a model proposed it or because a routine promotion needs restart. This is the explicit permission exception to be approved once; ordinary restarts can then use the delegated service-control rights without repeated administrator approval.

## Verification, rollback and completion

Policy artifacts, journals, preservation receipts, the promotion lock and permission plans use `%USERPROFILE%\.imagine\repository-promotion` through one shared path resolver. The Owner bridge, detached CLI, hooks and elevated permission helper must resolve the same location. Do not use AppData or TEMP: the Codex MSIX desktop can virtualize those paths into its package cache, making a file visible to the desktop but absent in an independent administrator terminal. Preserve legacy artifacts without rewriting their receipt paths; archive their physical location and hashes before recovery. Never silently treat an absent legacy record as proof that no work exists. The permission plan must retain its originally approved full-file SHA256 when copied to the shared directory.

Worker success is not verification. Backend and independent bridge must report the expected deployed SHA; the unauthorized intake fence must still reject; the deployed source and regression evidence must agree. Busy workflows wait automatically through read-only idle observations and resume the same merged run for up to 15 minutes, without replaying tests/review/merge or starting model calls. A persistent busy state remains durably pending for a later policy resume; it is not an approval exception or completion. denied Windows access is `awaiting_administrator`, never complete.

The exact reviewed reload helper is also pinned by its approved commit and content hash in an external control directory. A first rollback to a pre-policy tree therefore keeps the bounded restart tool even though that older release has no repository-promotion scripts. It still verifies the one fixed runtime repository, service, owned bridge and target SHA.

After verification failure, record the failure and restore the exact saved canonical source tree using a new forward commit/rollback PR. Restore only the accounted prior overlays and independently verify the rollback. Never reset main or rewrite remote ancestry. Concurrent remote/source drift or a failed rollback remains an Owner exception. Unknown cause is reported as unknown; failure evidence is retained rather than replaced with a guessed root cause.

The only complete state requires accounted working files, exact commit, confirmed remote preservation, measured tests, known PR/merge state, retained rollback and verified runtime. A rolled-back tranche remains failed, not complete. A pending/admin/idle record can resume only after checking its recorded state; other interrupted stages require inspection instead of replaying spent effects.

## Enforcement entry points

- `src/repositoryPromotion/`: policy gates, preservation, Git/GitHub adapters, independent review, coordinator, runtime and rollback.
- `scripts/repository/tranche.cjs`: begin/finish/status/resume and closed hook actions.
- Installed pre-commit/post-commit hooks enforce preflight and publication preservation; pre-push rejects main pushes and ref deletion.
- `scripts/subscription/startBridge.js` and `core/projectWork/service.js`: real registered-tranche preflight and detached accepted-work handoff.
- `scripts/repository/acceptedTranche.cjs`: fixed UUID-bound detached driver; survives bridge restart.

Ordinary developer/operator code still has its existing OS/GitHub authority; hooks and the supported workflow do not claim to remove the human Owner's administrative powers. Models in the offline sandbox receive no GitHub credential or generic promotion capability.
