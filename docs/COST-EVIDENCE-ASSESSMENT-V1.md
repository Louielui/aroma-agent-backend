# Cost evidence assessment v1

The existing authorized operations read feeds execution receipts, host work records,
runtime witnesses and account snapshots into `evaluateInvestigation`. This slice
adds a deterministic cost assessment after assertion grading and presents its
conclusion first in the existing source-bound answer. It performs no extra source
reads, model calls, schedules, account actions, pricing estimates or writes.

## Evidence boundaries

- Separate execution, returned model, measured usage, current activity, account
  quota consumption and billing per observed work/call/session.
- Preserve full per-model token receipts and helper/cache/last-turn/session scope;
  do not add account totals or overlapping session counters to job counters.
- Complete observed call receipts do not prove complete lifetime job coverage.
- Anonymous lane calls can confirm their call usage but cannot confirm an
  execution-to-job correlation. Host request/run/session identities are required.
- Suppress the duplicate canonical worker entry only when its exact record ID
  and worker kind are already present in an authenticated worker call chain.
- Current component activity uses existing fresh assertion witnesses; no historical
  job is marked currently running from matching roles, names or times.
- Missing/failed/interrupted usage is unknown, not zero. Same-identity conflicting
  receipts remain withheld. Zero counters remain measured zero.
- Codex quota and activity are separate account snapshots, not Xiangxiang-only
  usage or job charges. Claude automated quota remains unavailable. Actual billing
  and account-to-job charge linkage remain unavailable/unknown, never inferred.

The summary is bounded to observed sources and displays the latest four chains.
The full assessment retains all sampled chains, source receipts, timestamps and
references. Follow-up recommendations are read-only and do not pause schedules,
change settings or require new management permissions. Old saved reports without
an assessment continue rendering through the existing compatible path.

## Acceptance

The initial adapter/answer regression failed because the assessment was absent;
the anonymous-lane regression independently reproduced a false CONFIRMED job link.
Tests cover adapter integration, zero/missing/failed counters, stale and conflicting
runtime witnesses, canonical worker de-duplication, last-turn and cumulative scopes,
partial provider failures and bilingual source-bound conclusions. Runtime acceptance
reads existing authorized metadata without dispatching any model, builds both
language answers and verifies the loaded version and architecture entry separately.
