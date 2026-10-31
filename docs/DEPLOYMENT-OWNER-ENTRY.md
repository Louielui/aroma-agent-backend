# Exact-commit Owner promotion entry

This candidate is on Hold. This document is not deployment authorization.

The existing Action Gateway can receive an injected promotion handler; it stays
disconnected by default, and no new bridge/network/model operation is registered.
The reviewed host entry is `scripts/repository/approvePromotion.cjs`. It reuses
the existing Owner approval store (sealed work material, session, single-use nonce
and 10-minute expiry), Action Gateway store/Audit, Policy, coordinator, GitHub
gates, runtime verifier and forward-history rollback. There is no second promotion
engine or grant loaded from model/JSON prose.

## Three authorities, one reviewable Owner confirmation

Policy scope acceptance, Hold release and deployment consent are different sealed
records for the same complete SHA/tree/base, file set, operation list, immutable
test/review source and readiness package hash. Scope alone does not dispatch or
release Hold. Only all three approved, unexpired, materially identical records can
be consumed once to create an opaque in-process authority. A JSON object that says
`actor:owner` or `source:authenticated_owner` cannot substitute for that capability.
The old unconstrained coordinator exception callback is no longer an input.

The host entry exposes `inspect` and `approve`. Approval takes no approval file,
exception row, command or bearer credential argument. It requires an interactive
Windows terminal belonging to the fixed Owner profile and a typed full SHA plus
displayed material hash, after listing all three decisions and all effects. Empty
input never approves. It then re-inspects source/readiness before sealing the three
records through the existing Action Gateway. Do not automate the Owner's response.

All forward and conditional recovery authority expires after 10 minutes. It is
checked before status writes, exact-head merge, and deployment. A restarted process
cannot rehydrate authority from stored JSON; an uncertain or expired operation
requires reconciliation and fresh explicit recovery authority, not a replay.

Expiry is rechecked after idle inspection and long runtime regression checks,
immediately before checkout/reload, managed-client publication and rollback merge.
An already-started checkout finishes restoring its original private overlays as
transaction cleanup; this does not start a new deployment or extend the grant.

## Readiness and evidence

Only fixed UUIDs under the host promotion directory identify source evidence and
readiness material. Source evidence is independently re-read: original full TAP
counts/hash, exact candidate/tree and complete raw Claude review batches/diff hash.
No tests, commit, push, PR creation or review call is replayed. The new workflow
starts with a new run UUID and records its immutable evidence-source run ID; old
`needs_attention` rows are never supplied as workflow initial state or rewritten.

The readiness package is also SHA-bound. It identifies a fresh existing-mechanism
backup and isolated restore proof. The host checks the sealed manifest, canonical
and restored canonical bytes, required file/object hashes and counts. It re-reads
one to three active existing Owner historical records and their scoped Hindsight
originals, checking exact revision, source, approval and content hashes. No seed,
index, reflection, grant or model call is performed. These are production source
checks, not proof of conversational recall after deployment. The proof receipts
remain trusted Owner-host maintenance output, like the existing promotion receipts;
the policy does not claim to defend against a malicious Owner replacing host code.

Prepared readiness evidence is valid for at most 24 hours; source revision/hash
changes invalidate it immediately. Scope/base/SHA/material changes and expired or
replayed nonce/claim fail closed. No failed run is used as execution authority.

## Delivery sequence

The control/backup repair is a descendant of the accepted context candidate. Its
application dialogue files retain the accepted bytes; only the deployment/control
and backup paths change. Publish and independently review the new complete commit,
then create a new exact-SHA readiness package and run the entry in inspect mode.
The returned full SHA and material hash are the future approval subject. If any
executable file changes after review, repeat the complete source checks/review and
rebind the request. Original PR 109 remains on Hold; do not promote it separately.

Example shape (replace every placeholder with recorded exact identities):

```
node <reviewed-worktree>/scripts/repository/approvePromotion.cjs inspect --candidate <full-sha> --pr <new-pr> --evidence-run <new-evidence-run-uuid> --readiness <new-readiness-uuid>
```

Only after the Owner's explicit deployment decision, the Owner may run the same
reviewed entry in `approve` mode and personally type the displayed confirmation.
The agent must never provide that response or pre-create an approved record.

The four host contexts remain behind the whole local Policy gate. Their order is
tests, independent review, preservation, Policy. Then actual remote CI/review/head/
base is re-read, exact merge is checked, fresh idle witnesses are required, only the
fixed assistant/owned bridge reloads, the original launcher overlay is retained,
and the existing opted-in browser client is published and verified. No ACL,
credential, model-budget or business capability is added.

The existing runtime verifier covers source/boot/bridge/auth, offline regressions
and managed-client publication. A `complete` technical deployment record does not
replace the separately recorded post-deployment Memory Gateway and dialogue
acceptance. The Owner approval package includes the bounded follow-up plan and
contingent recovery; no new real conversation tests run during preparation.

## Backup repair and limitations

A fresh production snapshot was approximately 1 GB, 35,288 canonical records and
153,469 audit rows. The unchanged backup-and-isolated-restore mechanism completed
in about 75 seconds, beyond its old shared 60-second worker deadline. The repair
extends backup only to 240 seconds in the worker and 270 seconds in transport;
queue indexing and model deadlines remain unchanged. A safe `memory_backup_timeout`
reason is retained across the bridge/scheduler. Audit validation, destination
refusal, credential exclusion and full isolated table/file comparison are unchanged.

The first reviewed control commit still failed inspect because changing the
deadline on an existing POST line was classified as a new business write. The
subsequent content-risk fix recognizes only an identical literal method/redirect,
pure request.op deadline expression, and unchanged adjacent destination plus
headers/body context. It masks only the already-reviewed method in risk text;
the complete source diff remains in independent review. New methods, destinations,
payloads, new transports and side-effectful expressions keep the write gate.
There is no new path allowlist or inferred business-write exception. The earlier
run and its failed classification remain unchanged historical evidence.

The fixed candidate worker completed a new successful backup and isolated restore
with 682 required files. The maintenance job uses a new receipt directory. The
existing production scheduler's failed history and the running source are not
overwritten; its repair becomes active only after approved deployment. Old generic
failure records do not prove that every historical failure had the same cause.

On rollback use forward history to the saved canonical baseline and retain only
the exact original launcher overlay. Reconcile client publication/registration
receipts too. No live memory database overwrite, hard reset, force push, broad
process kill, expired authority reuse or failed-run relabelling is permitted.
