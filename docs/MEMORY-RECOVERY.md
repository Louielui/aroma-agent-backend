# Memory recovery and historical coverage

## Scope and delivery evidence

The canonical source is the local `xiangxiang_memory_core` PostgreSQL database,
not a Hindsight bank. A backup includes all four canonical tables: records,
record audit, principal grants, and access audit. This includes source-bound
mail messages, owner decisions, notification cursors, analysis scheduling, and
the separate historical-import checkpoint. Canonical restore verification
compares every stored table value, restores sequence values, and checks the
record audit hashes and final audit snapshots before any restore.

The private recovery bundle also saves the durable receipt outbox, capture
settings and backup schedule state, consolidation state, conversation files,
and `company-access.json`. Its manifest records captured and absent file
components, exact hashes, byte counts, canonical table counts, and the capture
window. File assets are captured before the database snapshot so a queue item
drained during the backup can be replayed by its stable ID rather than omitted.
Components are bounded snapshots, not a promise that future or unseen sources
have been captured. A changed/unreadable source file fails the backup visibly.

Each backup creates a fresh ACL-protected directory. Only the running
principal, LocalService, SYSTEM, and local administrators are granted access.
OAuth credentials, `.env`, bridge tokens, Hindsight credentials and PostgreSQL
credentials are not copied into the bundle. The manifest records that a new
machine requires new authentication. No backup is uploaded, and this delivery
does not automatically remove older backups or verification databases.

The existing in-app backup operation creates and verifies a new private bundle,
an isolated PostgreSQL restore, and an isolated file restore. The daily scheduler
accepts success only when both restore proofs exist. It records the path and
hash, shows failure without provider error text, retries failed jobs after
30 minutes, and retries an interrupted job after service restart. Manual run
shares its concurrency gate and bypasses the scheduled due date.

Schedule state records each attempt's `trigger` as `scheduled` for an automatic
tick or `manual` for an Owner run, including failures and interrupted-job retries.
A restart tick is a new scheduled attempt. `lastSucceededTrigger` identifies the
latest verified proof separately, so a later failed attempt cannot relabel it.
Legacy state has null trigger fields and remains unknown until a new attempt;
it is not evidence of daily scheduling. Current backend bootCommit/restart proof
is still required before accepting the deployed release.

Tests exercise 1,234 canonical records, source checkpoint values, audit damage,
file damage, excluded credential files, refusal to overwrite an existing file
restore destination, daily scheduling, retry backoff, and missing restore proof.
Live backup and restart evidence must still be collected from the deployed
service before calling that deployment accepted.

## Restore procedure

1. Keep the original bundle private and unchanged. Read `manifest.json` and
   check the stored manifest and canonical hashes against the backup result.
2. Restore into an isolated destination first. `backupRecovery.restore_files`
   refuses an existing destination and validates every asset before writing.
   `backupStructured.py verify-restore <canonical.json>` uses the existing local
   runtime and creates/reuses a separate `xiangxiang_restore_<hash>` database;
   it never overwrites the running core database.
3. On another machine, provision the local PostgreSQL/pgvector and existing
   Hindsight/Python runtime first; `scripts/memory/setupStructured.py` provisions
   the gateway role and schema. Restore canonical table values into a fresh,
   separately verified core and restore file assets into the backend data root.
   Switching the service to restored data is an explicit recovery deployment,
   not something the periodic backup performs. Keep the old data available until
   comparison and application acceptance pass.
4. Reauthenticate Google mailbox and Pub/Sub, the GPT subscription bridge, and
   any scoped agent credentials needed on the new machine. The restored source
   permission registry does not substitute for working provider credentials.
5. Rebuild derived Hindsight documents from active canonical records in their
   original scope. The existing owner-only `POST /api/v1/memory/catalog` operation
   `{"op":"index","id":"<canonical record id>"}` reconciles the Hindsight
   document and recreates it if absent, even when the restored index status says
   saved. The memory page exposes the same index operation. Archived, superseded,
   source-only, excluded and source-bound administrative mail records do not
   enter a shared bank. Mail uses its separate source-bound indexing workflow.
6. Verify receipt draining, current decisions and corrections, source access,
   cross-conversation recall with source IDs, mail Watch/reconciliation, and
   backup proof. Only then activate the recovered deployment.

Search indexes are derived and can be rebuilt; the recovery manifest does not
claim an untested Hindsight database image or a fully automatic machine rebuild.

## Administrative mail history

`createMailHistory` is independent of the Gmail Watch cursor and its expired
cursor recovery. `control(owner, 'start')` starts a snapshot-bounded full pass
using `in:anywhere before:<snapshot seconds>`, explicitly including Spam and
Trash through the provider's `includeSpamTrash` parameter. Pagination scans
10 message IDs at a time. Each processed ID advances a durable page offset;
process interruption replays an idempotent capture and resumes from that offset.
Newer mail remains the live notification/reconciliation workflow's responsibility.

The owner can pause, resume, cancel, or start another pass. Cancel preserves
progress so a later resume remains possible. The checkpoint survives restart
and belongs to the administrative mailbox identity. Source revocation prevents
further reads or cursor advancement. Failures retry after one minute without
claiming completed coverage.

Status shows running/completed/paused/cancelled/failed, snapshot start and finish,
processed IDs, retained messages, excluded messages and reasons, partial bodies,
pages, observed oldest/newest dates, and retry status. Null counters before the
first pass mean unmeasured; zero counters after a completed empty pass mean the
provider returned no matching messages. Completed means that bounded provider
pagination finished, not that every external historical item exists locally.

Sensitive content, unavailable bodies, and messages deleted before reading are
counted as exclusions. A truncated body is counted as partial. Attachments and
provider-deleted mail are not reconstructed; attachment ingestion remains
unconnected. Retention is separate from semantic indexing and model analysis,
which may finish later. Completion must show these counts and indexing progress
rather than hiding the exclusions behind a single complete label.

Official provider parameters:
[Gmail users.messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).
