# Bounded parallel source capture before the database snapshot

The retained scheduled failure at 2026-11-19T00:12:24.494Z exhausted the existing
240-second deadline while `verify_database` was active for only 14,958 ms. The
failed bundle contains 58,843 unique small file objects totalling 8,044,189 bytes;
their write timestamps span approximately203seconds. Its snapshot is1,042,667,217
bytes and was written shortly before the timeout. These are read-only observations
of existing failed evidence, not a new backup or restored proof.

Separate read-only profiling of that snapshot measured parse2,890ms,
validation5,594ms, canonical encoding4,687ms and envelope encoding5,140ms. No
database connection or production write occurred. The active failure phase alone
does not establish the historical bottleneck. The serial source stage is a
measured contributor: stat/read/JSON validation/hash occurred on the main thread
even though final object writes were already bounded and parallel.

This candidate moves the complete per-file capture into the same8-worker,
16-pending-task pipeline. Each worker still enforces the original path/symlink
scope, before/after source metadata, JSON validation, actual content hash and
exclusive durable object creation with fsync. Aggregate file bytes are reserved
under a lock before parallel ordinary-file reads; SQLite snapshots retain their
existing read-only WAL-consistent capture and actual-size limit. Duplicate
content gets one synchronized exclusive write but each source path remains in
the manifest and counts toward the aggregate512MiB limit.

The main thread collects results in original traversal order and drains every
future before `stage_recovery` returns and before the repeatable-read database
snapshot. Any source change, malformed JSON, size violation or worker failure
propagates; shutdown waits for active workers and no manifest success is emitted.
There is no early receipt or snapshot while queued files are still in flight.

Nothing changes the240-second timer, phase protocol, full four-table snapshot,
audit validation, database restore/value comparison, every-file seal/readback,
restore verification,512MiB asset cap,65536-file readiness capacity,24-hour proof
age, privacy/credential exclusions or destination ACL policy.
No parallel database operation or production restore is introduced.

Six sequential same-host source-stage measurements use fresh equal-sized
synthetic content every run,6,000files/816,000bytes per run. Before:20,094,
20,203,20,375ms (median20,203). Candidate:4,313,4,375,4,500ms (median4,375).
Every object hash was checked; no database or real data was used. File residency
is unclassified. This measures source-stage improvement only; it is not proof
that the complete real backup/restore now meets240seconds. Earlier exploratory
runs overlapped other tests and reused content; they are not comparative proof.

Regressions cover ordered bounded source parallelism, source mutation, invalid
JSON, aggregate capacity, duplicate races, propagated write failure, worker
shutdown, pending bounds and a real synthetic SQLite WAL snapshot whose source
bytes remain unchanged. Existing corruption, full restore/audit policy, hard
deadline and registered local-flow protections remain required.

This branch includes the held PR188 exact-baseline repair without changing its
code. No deployment, manual real backup rerun, new allowance, local inference,
guest, cloud fallback or automatic-memory restore is authorized. All23existing
roots remain paused,47task files and both old failures remain unchanged. A
separately approved exact-candidate full backup/isolated-restore check would be
needed to generate fresh real evidence before an executable deployment package;
synthetic evidence cannot renew the expired proof.

## Separately Owner-approved manifest capacity compatibility

A read-only names/size traversal found59,113paths whose files-array alone is
8,990,194bytes, above the prior8MiB manifest bound. This estimate reads no file
contents and is not a captured/sealed backup or restore proof. Evidence is kept,
not deleted or compacted to fit a capacity bound.

The Owner explicitly authorized an isolated16MiB manifest-byte bound. Only this
bounded manifest read capacity changes. The65,536entry ceiling,512MiB aggregate
asset bound,2,000,000byte limit for other evidence, descriptor identity/change
checks,24-hour freshness and every archived/restored hash/size/path/memory check
remain. The240-second backup deadline remains identical. A larger manifest is
not automatically trusted: its original sealed digest and complete files must
still validate. Tests accept a greater-than8MiB59,113entry synthetic manifest,
detect corruption in its final restored file, and reject16MiB+1byte,65,537entries,
oversized other evidence and malformed asset totals. This capacity decision is
not authority to run a real backup, activate models or deploy.

## Scheduled manifest file-count compatibility

The verified schedule completed at `2026-11-20T01:23:13.070Z` with 75,412
restored files, an 11,468,693-byte manifest and 9,637,631 asset bytes. Its file
count exceeded the former 65,536-entry readiness ceiling. Readiness allows
131,072 entries subject to the existing 16 MiB manifest and 512 MiB aggregate
asset bounds. The 240-second backup deadline, 24-hour evidence age, 2,000,000-byte
other-evidence limit and complete per-file, restore, table and memory checks
remain in force. Readiness uses the original schedule completion time for expiry.
The synthetic regression exercises all 75,412 entries and detects corruption at
the final restored file. Another fixture rejects 131,073 entries inside the byte
envelope. Verification can use the existing backup and isolated restore.
