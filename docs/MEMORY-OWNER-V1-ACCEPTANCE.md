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

The delivery suite completed 6,225 tests: 6,209 passed, 16 environment-dependent
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
history, a new backend boot and the actual canonical backup remain separately gated.
