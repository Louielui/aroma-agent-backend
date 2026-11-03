# Same-work coding recovery: isolated candidate

Status: offline implementation and evidence preparation only. Independent review,
exact-version delivery approval and real subscription continuation remain pending.
This document grants none of them. Prior candidate review cannot review this code.

## Scope and invariants

The existing Project Work service now has `prepareRecovery` and `approveRecovery`
operations through the existing authenticated Bridge and Owner HTTP route. They
operate on the original work UUID. They do not register a task, draft tests,
activate/reset an allowance, apply source, merge, deploy or release Hold.

Only failed, approved, repository-bound coding without a candidate/result or review
can prepare recovery. Unknown, source/permission, quota, cancelled, interrupted,
completed and candidate/review-stage failures stay unavailable. Existing active
worker/provider reservations must settle first. The root must be the original
active registered task, with its existing entered turn, fixed models and 8-helper /
0-website profile. At least two unused helpers are required before approval. This
is a happy-path minimum, not a reservation of extra allowance or a retry guarantee.
The existing durable native reservation fence still owns every actual send.
The host also requires existing automatic memory capture/indexing to be paused
and background indexing/consolidation idle before preparation and execution;
otherwise it returns `recovery_background_not_idle`. It never toggles settings.
This prevents recovery audit events from starting unbudgeted indexing. The shared
work record also retains recovery audit directly without forwarding its events
to automatic memory, including rejected approval and final Hold events. Normal
pre-existing work without recovery retains its prior event path. The shared
window must retain that pause, then restore the original setting under the prior
explicit Owner authorization; no new credential or memory-writing grant is added.

Preparation reads the current committed source and requires the registration,
goal, selected files, read-only dependencies and approved protected tests to be
identical to the original package. Only the runtime revision can advance. It
reconstructs the original snapshot and verifies its original sealed approval hash.
No historical source checkout or permission exception bypasses a changed file.

A new ten-minute, single-use Owner nonce seals the original failed evidence,
original snapshot, current exact runtime snapshot, original allowance counters
and request UUID. It is separate from the consumed original approval. The same
preparation request returns the same ticket, never a replacement nonce. A changed
request, expired ticket or restart needs explicit new preparation; there is no
automatic renewal. Source, definition, failure or budget drift rejects approval.

Execution stays in the existing shared lane and allowance root. The original
source/registration and failed steps remain. An appended recovery entry archives
the old terminal failure and records the new outcome. Every current-runtime
source verification still runs before/around provider work. Provider calls get
the identical originally approved package and original source-revision identity;
the recovery entry separately binds the new execution runtime. No old worker or
promotion receipt is replayed/relabelled. Recovery interruption does not auto-run.

## Why delivery must precede the copy change

The previous isolated candidate `24ff4f217f415042f026efa02e8b400e35e96d27`
contains a deterministic host-made catalogue fix. Deploying it before native
continuation changes the approved source and makes the original baseline green.
The recovery correctly refuses this. Its copy patch, original protected test and
four-passing real Sandbox receipt remain in that commit and private evidence.

This infrastructure delivery therefore restores `src/i18n/catalogue.js` to the
running baseline and removes only the extra derived host copy test from this
repository candidate. It does not alter/delete the formal task's protected test,
generated draft, registration or stored source. The original native work can
later perform the actual approved copy change. These are separate delivery steps.

## Existing authenticated API

Owner session and same-origin guards remain on `/api/v1/project-work`. The backend
adds its own boot SHA; browser-supplied SHA, file, model, command or budget fields
are refused. Preparation sends no model. The Bridge retains token authentication,
rejects browser Origin headers and checks the existing shared worker lane.

Prepare on the Owner-authenticated backend, with a fresh UUID:

```json
{"op":"prepareRecovery","id":"ceb79374-ecc1-4ae0-be42-290bb72e63da","requestId":"<fresh UUID>"}
```

Read the returned `run.recoveries` entry and `approval`. It binds the current exact
runtime SHA, immutable original failure and available root allowance. Explicit
approval uses the returned values, without adding source, goal or authority:

```json
{"op":"approveRecovery","id":"ceb79374-ecc1-4ae0-be42-290bb72e63da","hash":"<returned hash>","nonce":"<returned nonce>"}
```

Use the original GET `/api/v1/project-work/ceb79374-ecc1-4ae0-be42-290bb72e63da`
after a lost response; do not retry approval to infer success. Replayed approval
is refused. There is no new automatic chat routing or recovery UI button in this
candidate; this is the bounded existing-API connector, with an explicit receipt.

## Offline evidence and outstanding gates

Deterministic tests exercise original-root hard limits, new nonce vs old approval,
source/test/registration drift, expiry/restart, concurrent approval, disabled
execution, scope injection and original failure retention. A real local HTTP
router -> authenticated Bridge -> work service test uses deterministic source and
provider fixtures. None of this is a real subscription coding receipt.

The actual failed work and registered snapshot are also checked against committed
Git blobs with an explicitly labelled offline health fixture: the old copy-fixed
candidate must be rejected; the infrastructure candidate must reconstruct the
original approval exactly. No live worker service is instantiated or task changed.

The real root remains 6/8 used, two available. An independent review of this new
complete candidate plus one native coding and one text review requires at least
three helpers. Nothing here raises the hard-coded approved 8-call profile. The
minimum one-call shortfall needs a separately explicit Owner decision and a valid
metered authorization path, not a numerical edit, replacement task or new root.
UI rendering/pixel acceptance and retries are additional, unclaimed obligations.

Delivery order: full offline checks -> exact new commit and independent review ->
complete security-scope/host-check/backup readiness package -> specific Owner
deployment approval -> shared idle service window -> backend/Bridge exact-version
readback and original source/test checks -> separately metered native recovery.
No deployment or model approval is implied by starting this offline repair.

Rollback before native recovery uses the existing exact-source forward rollback
to `226fbd6518b3128d2154c5c99ac7b87a97e6bce3`, retaining the launcher overlay,
formal memory, original work/task/usage stores and all failure records. Invalidate
unclaimed recovery tickets through restart; never restore/reset allowance files.
Stop on source drift, insufficient allowance, failed gates or contradictory runtime.

Private evidence:
`C:/Users/louis/Documents/Codex/local-candidates/catalogue-provider-recovery-20261101`.
