# Reviewable memory consolidation

Private, active episodic records attributed to the owner or a measured result can
be consolidated through local Hindsight structured reflection. The existing GPT
subscription transport supplies inference. This is separate from receipt storage
and vector indexing; captured history remains available if extraction fails.

The worker processes one source at a time, with at least 60 seconds between
completions and subsequent starts. It pauses when there are at least 20 pending
consolidation candidates. A source can propose up to four candidates, so the
threshold is not a hard maximum of 20 records. Capture pause also stops new
consolidation jobs. Pausing does not cancel a request already in flight.

Durable source metadata records running, done, empty and failed outcomes, attempts,
retry dates and candidate IDs. Failed jobs retry at most three times automatically;
owner retry is explicit. A running job left by a restart becomes eligible after
three minutes. Successful source completion and candidate creation commit together.

Preferences and decisions retain their native memory types. Experiences and todos
are semantic records with a category; todos additionally record open or completed.
A todo is a remembered statement, not a dispatched task or proof of execution.
All generated records require owner approval. Each carries an exact source quote,
original date, reason and source fingerprint. Corrections identify an approved
same-type target and retain it as superseded only when the owner approves the new
candidate. Evidence withdrawal or changed approval prevents stale approval.
PostgreSQL rejects competing active decisions or preferences for the same scope
and subject, within the same transaction as record and audit writes.

The memory center offers review, pause/resume, source inspection, retry and the
existing approve/reject/archive controls. Chat recall prefers approved current
structured records over historical mentions while retaining the original history.

Limits: eligible sources are 2–12,000 characters. Matching context contains the
last 40 approved preference, decision or semantic records in the same scope.
Mixed legacy transcripts, assistant claims and unverified external claims do not
enter automatic consolidation. Exact quotes prove provenance, not semantic
entailment; owner review remains necessary. Broad historical normalization,
large-volume acceptance and external-agent integrations remain pending.

Validation evidence is recorded in the workspace delivery report. Tests cover
candidate-only extraction, four categories, quote rejection, source withdrawal,
correction and supersession, uniqueness conflicts, durable retries, restart
behavior, pause controls and owner/agent route separation. Live engine acceptance
on 2026-09-29 produced a source-quoted preference in about 64 seconds.

Live acceptance also exposed UTF-8 pipe chunk boundaries corrupting Chinese in
bridge responses. Direct PostgreSQL inspection found no stored replacement
characters. The bridge now uses a streaming UTF-8 decoder; a regression test
splits Chinese text into one-byte chunks and checks exact decoded values.
