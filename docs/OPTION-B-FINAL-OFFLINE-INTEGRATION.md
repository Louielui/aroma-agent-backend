# Option B final disposable integration

This is an offline integration of the reviewed preservation contract, existing
Option B controller, Gate, explicit admission fixtures, Windows Job fixture and
startup seam. It is not a production adapter installation. Historical UNKNOWN
attribution and NOT PASS preservation remain unchanged; no baseline is adopted.

## One controller, one existing Gate

`offlineMaintenance.js` retains the strict Windows UUID temporary-root guard and
synthetic database/source restrictions. No production route imports or installs it.
The existing OPEN -> DRAINING -> FROZEN -> verified release -> OPEN protocol is
unchanged. No global Node patching, service controller, audit framework or new
process manager is introduced. All process launch/containment uses the existing
disposable `OfflineFixtureJob.cs` and independently queried Job process lists.

The controller now integrates:

1. **Prepare/drain:** authenticated prepare closes root admission. Existing
   leased work and explicitly inherited child continuations finish final writes.
   Known non-database Jobs must become empty. Pending consent, stale leases,
   unknown/unavailable Job evidence, unsupported schema and bounded drain timeout
   fail closed. Only transient `gate_busy` acquisition refusals are retried within
   the original drain deadline; no lock stealing or stale-lease deletion.
   An auxiliary complete authorization-file read immediately before admission
   closure is encrypted as the prepare-time reference. It is not a full live-store
   snapshot: admitted tasks may still be writing other files. Before the
   isolated seal, the pinned existing pure rolling verifier must prove unchanged
   authorization security fields and any complete checkedAt/revision/audit delta.
   A pre-isolation grant change is not silently adopted. This verifier is the
   preserved Owner-local `preservation-option-a-v1/verify.cjs`, SHA256
   `8154cd60f7a4d3e39cbbd12445aee4b1d2b247d0cea27c4ad71c306b767fe268`;
   unavailable/changed artifacts block the controller. Task-only fixtures with no
   authorization file cannot introduce one later; production cannot omit its
   authorization inventory. Actor=owner remains a bookkeeping identity, not fresh
   human approval. A second capture cannot overwrite the first accepted reference.
2. **Complete preliminary evidence:** after application drain, capture encrypted
   protected bytes and a repeatable-read logical database image. It is explicitly
   not an isolated promotion baseline. No plaintext logical rows or authorization
   values are stored in the maintenance journal.
3. **Isolation and sealing:** verify logical equality, smart-stop only the
   disposable database, query every known Job empty, then seal complete protected
   data and stopped database storage before freeze/source promotion. Snapshots
   include all file bytes, empty directories, membership/hashes, lengths and exact
   file-ID/timestamp strings, plus complete synthetic logical/schema/role evidence.
   Re-read source and independently decrypt/read back. Changes to protected
   metadata/audit receive no maintenance exemption.
4. **Source operation:** before every promotion/forward rollback, independently
   re-read sealed evidence, source tree and Job state. Promote only the declared
   Git identity; rollback is a forward source commit. Neither operation restores
   task, memory, authorization or audit data.
5. **Restricted clone recovery:** create a separate `recovery-pg` copy from the
   encrypted stopped image. Only the predefined empty recovery Job and distinct
   fixture port may run it. Application Jobs remain empty and the Gate frozen.
   Independently compare clone logical contents/schema/roles to the sealed image.
   Stop the clone smartly and recheck original protected/database bytes and file
   identities. Original storage is never restarted or rebased for recovery.
6. **Release:** require current Owner authentication, unchanged protected state,
   unchanged original stopped storage, successful independent clone verification,
   empty Jobs, exact candidate/rollback source and no recorded failure. Complete
   the durable release journal within the existing Gate verifier before the Gate
   changes to OPEN. Release is never automatic.

## Durable failure and crash handling

The existing maintenance journal records pending operation intent and completed
stages. A narrow exclusive operation file prevents competing controller effects;
it is not the admission Gate. A process crash leaves the operation unreconciled;
no timeout removes that evidence. Any authenticated step failure writes and fsyncs
an immutable per-attempt failure marker. Reconstructing the controller or restoring
data/snapshot/source bytes cannot clear it. There is no reset/release-after-failure
API. Further recovery of a failed attempt requires a separately reviewed Owner
procedure, not deletion of the marker.

The external startup seam checks the failed marker, operation interlock and journal
before acquiring startup admission or importing either application version. Thus a
crash after the protocol release but before operation cleanup still refuses starts
until reconciled. Old/new disposable entry files contain no maintenance awareness;
both are launched through the same host seam outside the promoted source fixture.
Unreadable/corrupt journal or Gate state refuses initialization. Owner and service
credentials remain distinct; a service token cannot release maintenance.

## Snapshot confidentiality and bounded evidence

`offlineSnapshots.cjs` uses the existing snapshot walker and Windows DPAPI
CurrentUser via the pinned `offlineProtect.ps1` pipe helper. Full contents are
compressed and encrypted; plaintext/decrypted buffers exist only in the trusted
host/verifier memory. The helper accepts no filesystem path, credentials, service
action or elevation request. Tools are pinned per maintenance configuration and
checked on every invocation. Ciphertext/raw digests and run/configuration/stage
bindings are verified before use. Snapshot filenames are random create-new names;
writes are flushed before receipts are committed. Hard links, symlinks, unsupported
sizes and incomplete read-back refuse. Full snapshot payload is bounded to 256 MiB
(raw source data at most 128 MiB); larger inventories are unsupported, not truncated.

DPAPI execution identity is not Owner approval. Host-local encrypted evidence is
not a signature or a defense against a malicious administrator. No credentials,
raw authorization structures, logical rows or database role secrets appear in
the public journal, lifecycle receipt or test logs. Independent snapshot consumers
must be authorized and must verify the original receipt; they cannot recreate a
missing historical snapshot from a later object.

## Measured fixture boundaries and negative tests

The integrated suite uses real disposable PostgreSQL, fixed repeatable-read SQL,
549 synthetic protected files, known no-breakaway Windows Jobs and detached child
completion, authenticated Gate operations, distinct old/new entrypoints, exact
source commits and an independently started recovery clone. Lifecycle evidence
is written under the unique fixture root, with source identities, run and stage
timestamps but no credentials or protected values.

Each failure scenario has a new disposable attempt. Earlier tests which restored
negative bytes and continued the same attempt were replaced with persistent refusal
checks; no historical test/deployment receipt is relabeled. Negative scenarios
include pending consent, active timeout, crashed application/stale lease, unknown
Job evidence, corrupt Gate, changed authorization bookkeeping, unrelated membership,
damaged snapshot, source drift, changed physical database, pending memory work,
unknown SQL table, early release, changed memory/principal/audit/authorization rows
in the clone and a real self-exiting maintenance host with an outstanding operation.
Every rejected attempt stays DRAINING/FROZEN or externally unreconciled; no test
silently clears the controller's failure marker. Fixture cleanup smart-stops only
the UUID-scoped disposable clusters and releases Job hosts only after actual empty
membership. It does not restore production state or run Windows service control.

## Exact remaining production gap / readiness

**Production readiness: BLOCKED.** The integration proves only the supported
closed-world fixture launch/admission paths. An absent/unqueryable declared Job
blocks isolation. An unregistered writer changing protected data is detected by
verification, but the fixture does not enumerate or preemptively fence arbitrary
host processes, nor detect an unfenced write-and-restore between observations.
Directly invoking an old Node application outside the trusted host shim is not
OS-prevented by this code. Do not call these production containment guarantees.
Installed G1 Jobs, breakaway/nesting uncertainty, historical PID 11920 and
PostgreSQL launcher/restart ownership remain unresolved exactly as recorded.

The synthetic schema is deliberately limited to records, audit, principals,
access_audit and async_operations, plus captured column/role metadata. Additional
public tables refuse. This is not a complete Hindsight production database export.
Production needs its schema/tenant/extension/external-storage verifier and independently
enforced writer exclusion. Same-user file-based Gate/lease writes are not a new
OS security boundary between application and deployment control. Existing Owner
auth remains mandatory, and installed binding/access separation is still unproven.

## Minimum one-time bootstrap (proposal only)

1. Obtain the remaining complete installed writer/start/retry ownership and
   protected-root/exclusion inventory. Classify backup/scheduled work rather than
   stopping unrelated services. Resolve PostgreSQL and Hindsight drain/shutdown
   behavior. Preserve the adopted 549-file contract, backups and failed/UNKNOWN
   history. No proposed fresh reference implicitly adopts existing drift.
2. Separately approve an enforceable bounded offline window excluding all creators
   and restart owners before touching old bindings; verify idle without task
   cancellation. The existing uninstrumented running version cannot bootstrap
   itself by restarting first. If exclusion cannot be established, STOP.
3. Separately review and authorize exact immutable host bindings outside the
   release checkout, effective permissions/phase-control separation, native and
   scheduled entry coverage, isolation controls and production logical verifier.
   Retain old bindings/descriptors and recovery evidence. No privileges or grants
   are assumed by the fixture; any installation/security change needs its own
   explicit approval.
4. Under a later installation authorization, verify actual bypass refusal,
   restart/crash and old-version rollback binding, complete encrypted snapshots,
   strict release preservation and independently isolated recovery. Only then
   consider baseline adoption/promotion under a separate Owner approval.

This tranche does not perform any of those bootstrap actions. U1 stays inactive;
all eight deferred U1 criteria remain deferred. Stop after exact-candidate tests
and independent Claude Sonnet 5.5 review.
