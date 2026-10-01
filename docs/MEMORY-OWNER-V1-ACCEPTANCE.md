# Owner memory acceptance, 2026-10-01

## Completion boundary

Memory completeness means that connected, authorized sources have durable
receipts, source-bound originals, visible indexing and review states, safe recall,
versioned corrections, recovery and measured coverage. It does not mean access
to unseen sources, reconstruction of deleted data, automatic approval of a
sender's claims, or treating old messages as current business truth.

Six layers are retained: working, episodic, semantic, decision, procedural and
preference. PostgreSQL is canonical; Hindsight is a scoped derived index.
Sources and original dates are preserved. Owner decisions and reusable
preferences require approval of an exact revision. Superseded or archived
records must not become current answers. Tool/worker outcomes retain traceable
observations; remembering a request does not execute it.

## Evidence already measured

- Cross-conversation recall, quoted preference consolidation and correction of
  an approved earlier revision: see `MEMORY-CONSOLIDATION.md` and
  `MEMORY-RECALL-RELIABILITY-2026-09-29.md`.
- Recovery of the existing canonical store after bridge/Hindsight downtime:
  442 active general records were readable; no pending or unconfirmed general
  index rows were reported. Source-only and raw-only states remain distinct.
- Real administrative Gmail test: provider timestamp 2026-10-01T02:55:14Z,
  valid notification 02:55:30.712Z, persisted original 02:55:32.591Z, classified
  result 02:56:07.532Z. Earlier discarded notifications predate reason counters;
  their cause is unknown. This proves this tested delivery, not a universal
  latency guarantee.

## Required acceptance for this release

Before marking the release complete, verify the running `/health` bootCommit
against the delivered commit and collect the following evidence:

1. Independently measure bridge authentication, canonical database readiness
   and Hindsight readiness. Service downtime must not masquerade as an empty
   catalogue. Owner-login startup shortcuts must point at persistent supervisors.
   Verify controlled recovery of a process launched by the supervisor; never
   terminate a foreign listener. A Windows reboot/login remains a separate
   acceptance event when the owner chooses to perform it.
2. Durable receipts drain after recovery, preserving stable IDs and original
   dates. New conversation recall contains canonical source IDs. Corrections
   and exact-revision approval retain the old audit trail; revoked/expired
   scopes, mail permissions and archived revisions are excluded.
3. A full Gmail snapshot finishes provider pagination with its durable cutoff,
   retained/excluded/partial counts and explicit reasons. Restart resumes a
   mid-page checkpoint. Notifications continue receiving newer mail.
4. Dedicated mail indexing reports saved, raw-only, source-only, pending and
   exhausted failure states. Natural historical mail queries return canonical
   excerpts, original IDs/dates/hashes and separately labeled Owner decisions.
   Revoked source rights deny recall and cannot leak prior mail through chat
   history. General memory banks never include administrative mail.
5. A fresh recovery bundle includes canonical tables, audit chains, receipt
   queues, conversations and permission state. Both isolated database and file
   restores match all saved values/hashes. Daily scheduling persists proof and
   retry state. OAuth credentials are excluded and require reauthorization.
6. Owner-triggered index rebuilding works from retained canonical originals
   with visible progress and bounded retries. Restore does not depend on a
   surviving Hindsight bank or promote unapproved material.
7. The memory and mail pages display measured counts and actionable controls in
   both locales. The in-app architecture checklist states the same accepted
   capabilities, partial integrations and remaining work.

Injected tests cover large snapshots, crash replay, permission loss, quota
backoff, cancellation, corrupted backups and lost derived indexes. These tests
supplement live evidence; they do not replace deployed acceptance.

Mail semantic indexing uses one completion-driven worker, with no overlapping
retains. It waits 2 seconds after successful indexing or bounded rebuild progress,
30 seconds after idle or ordinary failure, and polls foreground/analysis eligibility
every 5 seconds. Foreground cancellation and the application's existing 60-second
cooldown retain priority. These are scheduling delays, not measured throughput or
a promised backlog completion time; retain latency and subscription availability
still determine progress. Source-bound lexical recall remains available while
semantic indexing is pending.

A provider quota failure persists a mailbox-wide 15-minute circuit in the excluded
`admin_mail_index_runtime` checkpoint. It survives process restart, a racing source
revision and manual retry, preventing other pending originals from bypassing the
same cooldown. The mail page reports its expiry separately from per-source retry
and exhaustion counts. Rebuild manifests reset at most 20 originals per pass,
checkpoint every source, and finish queue preparation before model indexing.

## Explicitly unavailable sources

Ivy's private chat/memory, mail attachments, provider-deleted messages,
unconnected business systems and external agents are outside current source
coverage. Mixed legacy transcripts and oversized text can remain retained
originals without automatic extraction. SOP links refer to the original
knowledge source and version; memory cannot replace the authoritative document.
Keep these limits visible while their adapters are added.

See `MEMORY-RECOVERY.md` for backup/recovery and the full-mail snapshot,
and `MEMORY-RUNTIME-RELIABILITY.md` for local startup and supervision.

## Delivery verification

The recovery follow-up suite completed 6,230 tests: 6,214 passed, 16 environment-dependent
tests skipped, zero failures. It ran with four concurrent test processes. A prior
default-concurrency run had one unrelated WorkerFlow fixture failure; its log is
retained. That failure did not reproduce in its focused run or 24 concurrent
isolated repeats, and its original cause remains unproven. No WorkerFlow code was
changed to make the result pass.

Independent process tests verified that an offline receipt survives an exit,
drains after restart, remains source-searchable with a raw-only index, and replays
without a duplicate or a second audit change. Recovery fixture tests preserved a
historical import checkpoint and department permission scope, excluded credentials,
rejected modified audit/assets and overwrite attempts, and measured protected
Windows backup/restore ACLs. These are isolated acceptance proofs; live provider
history and a new backend boot remain separately gated.

## Independent live data acceptance, 2026-10-01

The deployed authenticated bridge and canonical store passed six-layer acceptance
without model calls. Exact-revision approval, candidate exclusion, current
decisions and preferences, conflicting active revisions, supersession, archived
working context, procedural source versions and stale multi-row rollback were
checked against real PostgreSQL. Thirty-four hash-linked audit snapshots matched.
The eleven clearly marked non-business fixtures were archived; no current recall
remains from those fixtures and principals were unchanged. This independently
verifies the core store; it does not certify the old running backend's new HTTP
routes or interface. Core verifier commit was 925a857, while the backend still
reported bootCommit 640aefd.

A fresh independent recovery bundle matched four canonical tables: 1,610 records,
6,009 audit events, zero principals and zero access-audit rows. All 181 private
recovery files matched the sealed manifest in a new isolated directory. Snapshot
SHA-256 was 7ac86a56365eae1b87b83cda852f8a8be2adb66e9f919627521ddc1533d0181a.
Both the backup and restored files had protected Windows ACLs without inherited
rules. This is actual backup/restore evidence, not daily-scheduler acceptance or
a real member-scope restore claim; the captured principals table was empty.
Credentials remain excluded and the derived Hindsight index must be rebuilt.

That acceptance also exposed a recovery policy gap: a self-consistent backup
containing two active preferences for the same scope and subject could be restored
by the old verifier. The corrected verifier rejects duplicate active decisions
and preferences before database access, preserving distinct scopes, subjects,
types and inactive history. Active decisions and preferences also require
non-empty string scopes and subjects; malformed keys are rejected consistently
before database access, while inactive historical rows remain unchanged.
Newly created isolated restore schemas also enforce
active preference uniqueness. Normal live commits already enforced this rule;
no live schema migration or Owner policy change was required. A native PostgreSQL
JSONB proof reproduced the old acceptance, and the same snapshot was rejected by
the repaired helper with zero database connections. The full-mail snapshot,
source-bound live chat, new backend boot, derived-index rebuild and daily-scheduler
proof remain required acceptance items.

Daily scheduler acceptance must identify a completed scheduled attempt after the
verified backend boot, its restore proof and its next daily due time. A successful
manual run alone does not prove scheduling. Attempt trigger and successful-proof
trigger are distinct so a later failed attempt cannot relabel an earlier proof;
legacy state without those fields remains unknown.

## Running backend acceptance on 744e93e

After the Owner restarted the local Windows service, `/health` reported the
delivered commit and boot time 2026-10-01T11:54:57.515Z. All three independently
probed memory services were ready. Owner HTTP acceptance exercised all six
layers, exact approvals, corrected current decisions, superseded exclusion,
procedural source-version preservation, working closure and traceable audit.
Its eight clearly labeled synthetic records were archived in cleanup.

The real scheduled backup completed at 11:55:03.287Z after that boot, with both
attempt and successful-proof triggers recorded as scheduled. Its next due time
was exactly one day later. Independent restore verified 1,622 records, 6,503
audit events and 182 private files, sealed hashes and protected Windows ACLs.
No manual backup was substituted for the scheduler evidence.

A bounded general rebuild used one synthetic record in a previously empty
allowed memory scope. The normal background worker moved it from pending to
saved; the retained Hindsight document matched the canonical text. Source and
approval were unchanged, as were 536 pre-existing originals and source rights.
The fixture was archived and its five-event audit chain was verified. This
proves a scoped Memory Gateway operation, not a connected external QA Agent.

Administrative mail's named notification test passed natural source-bound chat
with the exact original ID, canonical ID, original date, content hash and Gmail
link. The mail rebuild preserved all six existing derived documents and the
original and Owner decision while advancing its durable cursor. The full-history
snapshot and derived backlog remain in progress; their current coverage must
come from the mail page. A read-only identity audit found no duplicate original
keys: 675 originals had 675 distinct mailbox/message identities. Thread review
and immutable original records deliberately have different stable IDs.

Live acceptance exposed one permanently ineligible original repeatedly failing
Hindsight text policy. The correction reuses that authoritative policy on the
exact indexed body and metadata. It preserves canonical originals and lexical
recall, reconciles old exhausted/future-retry records to explicit source-only
state and reports the reason. Eligible provider failures remain retryable and
quota cooldown remains in force. This correction requires its own new-backend
load and live reconciliation check; injected tests alone are not final evidence.

The interface correction distinguishes historical originals retained from
semantic documents indexed, and uses backup-specific completion/due labels.
The architecture checklist now describes the dedicated mail index as connected
within its measured scope, with full-history and index coverage shown separately.
Full history/backlog completion, corrected-version load and corrected UI/reason
readback remain outstanding; memory completion is not yet claimed.

The corrective version passed all 6,237 tests: 6,221 passed, zero failed and
16 were explicitly skipped. The seven additional mail eligibility cases include
old exhausted attempts, future retry deadlines, metadata policy, local
classification during quota cooldown and bounded rebuild eligibility.
