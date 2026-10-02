# Background mail index reads

The background worker previously materialized every canonical mail message and thread before choosing one original. An actual mailbox read on 2026-10-02 returned about 220 MB across 30,491 records and took 14.2 seconds. This was a measured read-stage cost, not the model's latency or total indexing duration.

The worker now validates originals once on a cold start, then reads mailbox-bound, body-free revision manifests. The existing fixed sequence cutoff, keyset pagination and byte bound remain. Only selection metadata crosses this read transport; canonical originals and audits remain unchanged in PostgreSQL.

An ephemeral eligibility cache stores each original's canonical version, hash, integrity result and local policy reason. It is not memory storage, a canonical fallback or an approval. A new process or mailbox change starts a fresh validation. Later source changes require revalidation, bounded to twenty originals per attempt. Incomplete validation yields before extraction so that policy reconciliation still precedes provider work. Successful canonical index updates refresh the cache only after the normal audited commit.

Before any provider read or retention, the selected original and its current owning thread are reread and checked for source identity, mailbox, revision, original hash, visibility, expiry and local eligibility. Normal persistence performs these checks again. A manifest failure fails closed. Existing Owner decisions, index attempts, retry deadlines, shared subscription cooldown, source-only policy and serial fairness remain authoritative. No exhausted source is automatically reset.

Cold-start validation still reads all originals once. Source search, recall, rebuilds and UI statistics retain their existing source-bound reads. This change does not claim complete indexing, faster model inference, full mailbox coverage or final memory acceptance. Live throughput must be observed after the new backend is loaded.
