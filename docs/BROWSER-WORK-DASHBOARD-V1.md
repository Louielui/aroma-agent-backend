# Browser work in the Owner system

The main conversation store previously had no reader for the independent
Browser read jobs or native-operation audit. A visible extension work card
therefore did not make its work visible in the main application.

The Daily navigation now opens a read-only Browser work panel. It groups saved
read parent chains into separate topics, presents the latest durable state and
phase, and shows the latest saved question and answer with earlier turns
collapsed. The same native service supplies current questions and results
through a cloned inspection projection. Content-free native audit records
remain visible after restart; unavailable native questions and answers are
explicitly unavailable, never reconstructed from screenshots or old models.
Topic identity is the saved conversation root. Older task-only jobs have no
page identity metadata, so the view does not invent current tab titles or
assert that a historical topic is still open in Chrome.

Authenticated Owner-session GET endpoints expose only display fields. Service
tokens alone, cross-site requests, unexpected query parameters and write verbs
are refused. The projection contains no native ticket, executable action,
frame, screenshot, request hash, raw page URL, billing object or captured text.
There is no route to read dispatch, model completion, native claim, Stop,
website writes, conversation deletion or credential handling in this view.

Status reads use one pending request and a two-second minimum observation
interval, only while the panel is open and an observed job is active. The
130-second observation budget, close/selection generation checks and request
abort prevent stale replies from replacing a new selection or reopening a
closed panel. Failed observation marks the view unconfirmed, retains earlier
retrieved content and stops the spinner and clock. Manual refresh still reads
only the original records. Terminal clocks remain fixed. Unknown phases and
missing timestamps cannot create activity or an invented duration.

All saved read jobs are bounded by their existing 500-job store. The latest 100
native operations are shown, retaining every current live job; older audit
coverage is disclosed. More than 5,000 audit files, malformed records, cyclic
or missing read ancestry and unreadable sources produce explicit incomplete
coverage instead of an empty-success claim. Original records are not changed.
Native questions and answers remain process-lifetime data, matching existing
retention. This tranche adds no new retention or browser permission.

Regression tests use nonzero saved chains, separate topics, real native-service
inspection, content-free restart records, absent/unknown evidence, field
omission and real authenticated HTTP refusal/readback. Real headless Edge
drives the served main application panel through GET only, retains a chat
draft, verifies phases and terminal clocks, treats hostile content as text,
checks status loss and discards delayed replies after close. These are fixtures;
existing saved Owner records are checked separately after gated deployment.

The extension and Native Host do not need an update. Preserve existing runtime
launcher and environment bytes, rollback points and original installation
receipts. No business writes or restaurant production database are involved.
