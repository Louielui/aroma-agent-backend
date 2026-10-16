# Option B isolated-window preservation contract

Status: OFFLINE DESIGN AND DISPOSABLE TESTS ONLY. No production baseline adoption,
installation, release authorization or change to historical verdicts. The closed
company-access investigation remains UNKNOWN; historical preservation remains NOT
PASS. Its missing exact before/after contents must never be reconstructed from
later rolling audit. Retain its original receipts, complete available encrypted
snapshots and identities unchanged.

## Smallest change

Reuse the existing durable Gate and Owner authentication, Option B controller
lifecycle, `offlineMaintenance.snapshot` membership/hash walker, existing external
company-access rolling-audit verifier, encrypted snapshot/receipt procedure and
logical-memory preservation components. Add no audit framework or global runtime
fence. This tranche defines the stricter production composition and tests it in
disposable files; it does not widen the fixture controller's path restrictions or
wire an adapter into production.

The improvement is **complete independently checked snapshots at the isolated
boundary**, plus strict full-state comparison through release. A normal-operation
rolling-audit rule is not a maintenance-period exemption. Hash-only observations
cannot provide a before/after authorization comparison.

## Evidence stages and exact rules

| Stage | Required observation and decision |
|---|---|
| H: historical contract | Keep the exact original 549-file manifest digest, full file identities, encrypted backups, adoption/rollback evidence and all previous failed/UNKNOWN receipts. This contract neither changes their verdicts nor adopts a replacement baseline. |
| O: operating/pre-drain | Capture complete encrypted bytes and membership, not just hashes, when comparing legitimate runtime changes. The known writer may update checkedAt/revision/audit. Require strict security-field equality and the existing full rolling-retention proof for any claimed writer-compatible delta; insufficient overlap/count/evidence stays UNKNOWN. A compatible pattern or actor=owner does not prove a human request or unique process writer. |
| D: admission closed | Existing authenticated prepare atomically changes OPEN to DRAINING. All new roots, timers, native/scheduled/independent starts are closed. Previously admitted work may finish final persistence. Pending consent, incomplete/unknown tasks, stale leases or drain timeout block isolation; do not cancel work or edit records to obtain idle. |
| I: independently isolated | Close all restart paths and independently prove every in-scope writer/descendant has completed or is safely isolated. No PID-only or caller idle claims. Verify Gate run/generation, empty leases, fresh complete isolation inventory and installation/tool bindings. Unknown writers prevent capture and source promotion. |
| S: sealed per-run snapshot | After I and before source promotion, capture complete protected file bytes, full manifest membership/types/hashes, full authorization structure and complete database evidence. Repeat independent reads under maintained isolation and reject any membership/content discrepancy. Bind artifacts to Gate run/generation, approved source identities, manifest digest, isolation evidence digest and exact producer/tool identities. Independently decrypt/read back and verify full contents and hashes. Missing, corrupt, unavailable or unbound snapshots block promotion. |
| P: before source promotion | Independently recheck isolation and all sealed protected evidence. All protected bytes/membership must match S. Promotion changes only the approved source tree, never protected data. Record the exact promoted commit/tree. An exception requires separate authorization and is outside this contract. |
| R: before release | Independently recheck maintained isolation, protected membership/bytes, authorization structure, database evidence, snapshot integrity and exact approved candidate or rollback source. Any unexplained difference blocks release, leaves the durable latch closed and preserves both complete snapshots and failure evidence. Owner authentication and the existing release verifier remain mandatory. |

S is a **proposed per-run comparison reference**, not authority to accept drift
from H. Reconcile H->S separately: exact hashes for fixed files; only previously
authorized runtime transitions with complete evidence may explain normal mutable
data. Every unexplained gap stays blocked. The isolated reference needs separate
Owner adoption where the existing preservation/deployment procedure requires it.
This design approval and test PASS do not provide that adoption. No old failed
deployment becomes PASS because a later isolated snapshot exists.

## Authorization and mutable metadata

Verify the entire authorization object, including users, roles, grants, principals,
tenant identity, subjects/identity bindings, mailbox/Drive/source bindings,
suspension/revocation state and unknown future fields. Keep the complete original
bytes privately encrypted; redacted projections are reports, not the evidence
source. Security comparisons must not use a whitelist that silently drops a new
field. Strict JSON parsing rejects duplicate keys and malformed structures.

Before isolation only, the existing rolling-audit verifier may establish a fully
observed writer-compatible delta: contiguous revisions, exact retained overlap
and order, correct eviction count, no modified retained records, allowed actor and
target, validated checkedAt ordering, and equal non-bookkeeping state. It cannot
establish unique caller attribution. A grant/revoke/login/suspension change requires
its own existing authenticated authorization evidence; never approve it merely
because an audit entry calls its actor owner. Unexplained security changes block.

After I, checkedAt, revision and **every audit byte** are protected just like users
and grants. Even a perfectly valid mail_connected append, normal rolling eviction,
same-value rewrite with changed serialization, status timestamp update or
well-formed metadata change must fail strict comparison. Do not run the normal
rolling-audit exception to waive an isolated-window difference. Do not edit a
receipt or restore bytes silently to erase the failure. A discovered mutation
invalidates the current maintenance attempt; further recovery is separately
authorized and retains the failure. A clean re-read alone cannot clear it.

## Full membership, snapshots and independent verification

Retain all 549 original paths and identities; no implicit exclusions for audit or
credentials. Bind normalized absolute paths without aliases, duplicate/case-fold
collisions, traversal, reparse points, symbolic or hard links. Inventory the exact
declared protected roots and previously approved exclusions to detect added,
deleted or renamed members as well as modified contents. If the installed scope
cannot establish completeness, it is an installation blocker. Preserve necessary
path/type, length, filesystem timestamps and stable file identity evidence, while
never interpreting a timestamp as writer attribution.

Store snapshots outside production/release/protected roots with unique create-new
paths and existing Owner-local encryption. Preserve actual observed bytes; never
rebuild missing source bytes from parsed objects or later events. Hash plaintext
in memory, encrypt and independently decrypt/read back, then compare digests and
full file membership. Record independently hashed receipts without credentials or
raw authorization values. Hashes/unsigned local receipts are integrity/provenance
evidence within the trusted host boundary, not human authentication or protection
against a malicious administrator.

Maintain isolation continuously from I until authenticated release. Repeated
snapshots alone cannot detect a writer that changes and restores bytes between
reads. Therefore any loss/uncertainty of containment, unknown process, broken
startup binding or stale evidence blocks the attempt even if endpoint hashes
match. This contract does not solve the outstanding production containment gate.
Maintain a durable failed-attempt record through the existing host maintenance
journal: release verification must consult that recorded failure, not just fresh
hashes. Implementing this production binding is a remaining prerequisite.

## Logical database and recovery boundaries

The 549-file contract does not replace complete logical database evidence. Capture
schema/version and all in-scope tenant/bank data, memory/content/vectors, principals,
identity/authorization mappings, access/audit history, queues/async operations and
independent worker state. Unknown schema, table, extension, external storage,
writer or restart owner blocks capture. Use the existing logical verifier with an
explicit schema-pinned production adapter; synthetic fixture tables are not that
adapter. Canonical export ordering may be defined in advance, but no security or
logical fields may be silently omitted or normalized away.

Drain application/worker activity and prove final commits completed before a
consistent logical capture; validate smart database shutdown and capture complete
physical cluster/storage evidence only when safely stopped. Hindsight shutdown
can affect embedded PostgreSQL; verify installed lifecycle ordering instead of
assuming an application stop leaves the database available. Production SQL or
shutdown is not authorized by this tranche.

Keep original protected database storage stopped and unchanged during isolated
verification. Prefer the existing disposable restore-verification path on a
separate encrypted-backup-derived clone for database startup/recovery tests; compare
its complete logical export with S. Clone paths/ports/credentials/storage must be
independently isolated, with no external callbacks or application job execution.
Do not recapture changed production databaseFiles after recovery and call that
preservation. Any alternative permitting original-storage recovery writes needs
an explicit separately reviewed narrow rule and Owner approval, not a blanket
physical-file exemption. Recheck original stopped storage and all logical evidence
before release. An unexplained task/auth/memory/audit difference always blocks.

## Disposable verification scope

`optionBPreservation.test.js` uses actual `createRegistry` writes against synthetic
authorization fixtures, existing `createGate`, existing strict rolling verifier
and existing full membership/hash snapshot helper. All full snapshot contents are
synthetic and remain inside a UUID-scoped OS temporary directory. A fixed 549-file
fixture represents the original contract's count, not its real contents. Logical
database exports in these tests are synthetic; the existing Option B lifecycle
suite separately tests real disposable PostgreSQL and Windows Job descendants.

Tests must establish: a known admitted normal update completes during draining
before isolation; complete retained-overlap evidence explains that pre-isolation
delta without human-attribution claims; snapshots before isolation are refused;
snapshot bytes independently reproduce manifest hashes; post-isolation security,
metadata, audit, unknown-field, membership and logical-data mutations block both
promotion precheck and release; tampered/missing snapshot evidence refuses; service
credentials cannot release; and failure remains recorded even after disposable
bytes are restored. Corrupt Gate and unknown writers remain covered by the
existing lifecycle and admission negative tests.

## Remaining production prerequisites and stopping point

Implement and independently review the exact host-journal failure binding, secure
full snapshot producer/read-back, production logical verifier, complete protected
root/exclusion inventory, independently enforced writer/restart isolation, immutable
startup/rollback binding and Owner-controlled adoption/recovery operations. Preserve
the historical UNKNOWN finding and 549-file evidence throughout. No admission
closure, isolation, baseline adoption, log elevation, service operation, PR merge,
deployment or U1 activation occurs here. Stop for Owner approval after offline
review; all existing production-installation blockers remain.
