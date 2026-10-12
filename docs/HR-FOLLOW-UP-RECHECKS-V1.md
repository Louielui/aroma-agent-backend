# HR follow-up rechecks v1

An explicit HR request or tracking-panel button rereads unfinished evidence-linked
notes using their original company, Winnipeg day and report kind. Manual notes and
completed notes are excluded. The natural-language request must be made in a
conversation linked to HR. Chinese and English requests use the same service.

## Read and comparison boundary

The existing fixed GET attendance/comparison readers are reused. Notes sharing one
company/day/report group share a read; at most five groups are queried per request.
Remaining groups are visibly unavailable (`read_limit`), not silently skipped.
Repeated request IDs reuse a saved result; concurrent repeats share the same read.
There are no model calls, scheduled refreshes, new connectors or write scopes.

Matching requires the same employee plus scheduled shift ID, or the same employee
plus punch ID for attendance/unmatched-punch notes. A missing record, reassignment,
partial source, inferred/contradicted association, wrong scope/company, or source
that is not newer than the baseline remains unknown. Failed reads remain unavailable.
Unknown automatic/manual closure does not establish a manual clock-out. Absence and
currently-working claims remain unknown.

Complete, newer, exact-match evidence produces changed/unchanged observations. Only
changed records whose findings are cleared and whose clock-out is present can
propose `done`. Clearing findings does not establish the real-world cause: schedule
edits and permitted variations may explain changes. The Owner sees both snapshots.
After confirmation, the most recent accepted evidence becomes the next comparison
baseline; the original source is never overwritten. Owner reopening of a completed
note does not itself constitute evidence of a new discrepancy.

## Persistence and confirmation

The bounded report is saved in the existing workspace file. Preparation changes no
note state, revision or next-step text. Each proposal binds exact note ID, revision,
original source and comparison baseline, and expires after one hour. The Owner
selects items (none preselected) and confirms. The server resolves proposed states
from the saved report and rejects supplied commands, states and evidence. Selection
is atomic: one concurrent note edit rejects all pending selections. Already applied
selections are idempotent. Original source and next-step notes remain unchanged.

Each accepted note links its saved report. Reports retain before/after evidence and
accepted IDs; they survive reload along with chat report buttons. A latest-report
button exposes reports created outside chat. HR history is bounded to 100 rechecks;
capacity refusal is visible and does not discard old evidence. Archival is not yet
connected. Unknown/unavailable results cannot be selected as resolved updates.

Owner authentication, demo enablement, same-origin POST checks and HR membership
remain required. This feature does not edit 7shifts records, contact employees,
approve payroll or automatically reopen/complete notes.

## Acceptance

Tests cover exact ID matching, changed and unchanged evidence, partial/missing/denied
sources, reassignment, stale reads, manual versus automatic clock-out, baseline
continuation, optimistic revisions, expiry, repeated requests, bounded grouped reads,
atomic updates, forged inputs and bilingual authenticated HTTP/browser flows.
Chromium tests exercise Chinese desktop and English mobile, safe source rendering,
confirmation, source preservation, reload, saved chat offers and zero model calls.
