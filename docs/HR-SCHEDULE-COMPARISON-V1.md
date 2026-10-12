# HR schedule/punch comparison v1

Owner-approved read-only comparison, not an attendance disciplinary decision or payroll workflow.

## Source contract

Owner intake accepts one explicit Winnipeg scheduled-start day, today or yesterday. Missing dates ask before any GET. Impossible, future and multi-day inputs fail closed. HR prepares the message without submitting or overwriting a draft.

The existing fixed-company credential reads only published non-deleted `GET /v2/company/{company_id}/shifts`, named `time_punches` and exact `users/{id}`. Schedule ranges use timezone-aware ISO filters. Punch clock-in dates include the previous and following civil day (DST preserved) to accommodate early starts and overnight associations. Each list has a three-page/300-row cap, bounded transport and access-revocation checks. Only explicit terminal-null cursors prove scoped completeness. Any required source failure returns unavailable; no automatic permission expansion or retries.

Official contract: https://developers.7shifts.com/reference/listshift and https://developers.7shifts.com/docs/synchronizing-shifts-for-data-warehousing . Schedule reads use API 2026-01-01 and explicit `consider_tz_in_ranges=true`; the older 2025-03-01 schedule contract does not expose this timezone control. Existing punch reads retain API 2025-03-01. Default/published filters exclude draft history. A currently published schedule is not proof of its historical version.

## Evidence and findings

Exact shift ID plus matching employee and location establishes the source association. Contradictory IDs are exposed, not overwritten. A missing shift ID permits only unique same-employee/location temporal overlap, marked SUPPORTED. Ambiguous overlap or an explicit association outside scope stays UNKNOWN. No invented grace period or time rounding changes the raw comparison.

Aggregate first clock-in and last clock-out for multiple linked punches. Any open linked punch leaves the aggregate finish unknown. Show both signed time deltas, past-end open records, auto clock-outs, overnight dates and unmatched selected-day punches. Unassigned shifts do not imply employee absence. Time differences are follow-up candidates, not confirmed lateness, early departure, overtime or misconduct. No linked punch does not establish missing punches or absence, even with complete lists. Current working status remains UNKNOWN.

## Durable delivery and boundaries

Chinese and English use the same deterministic report. Same-origin Owner path, exact request/conversation idempotency, access rechecks on replay and source-bound history scrubbing reuse the existing report gateway. Reports persist as dated snapshots, refreshed only by a new query. Model calls: zero. Punch edits, payroll approval/submission and external contact: zero. Central and topic model settings remain unchanged.

Architecture row remains partial: historical schedule revisions, employee/on-site confirmation, formal lateness/overtime policy and payroll actions are not connected.

## Verification

Focused regression covers API projection, exact/ambiguous/contradictory associations, split and overnight punches, open punches, unassigned/future shifts, civil DST windows, invalid/revoked sources, pagination bounds, bilingual real HTTP replay/history and responsive HR preparation/persistence. Full suite and live runtime/real-source checks are recorded in local delivery outputs.
