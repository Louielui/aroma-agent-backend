# Investigation Intelligence v1: generalization acceptance

This delivery strengthens the existing read-only investigation chain. It adds no
management write permission or Action Gateway. The runtime brain selection remains
unchanged.

## Corrected gaps

- An Owner plan with only denied required sources now creates a saved report.
  Required-source access is UNAVAILABLE / not_authorized, with attempted=false.
- An authorized source without a receipt is UNAVAILABLE / read_receipt_missing,
  with attempted=null. This does not invent a failed read, source ID or citation.
- Unmapped required operations stay UNAVAILABLE; an unidentified operation stays
  UNKNOWN. Both remain explicit unresolved requirements.
- Denied required sources do not prevent one bounded continuation to an authorized
  code-owned evidence equivalent. Existing limits (one round, at most two sources)
  and authorization intersection still apply. The original gap remains unresolved.
- Empty external search is UNKNOWN and bounded; failed access is UNAVAILABLE.
  A source without usable records cannot contribute unverified positive prose.
  Genuine clarification and reviewed source-bound limitations remain intact.
- The short failure brief cannot conceal an unread required source. Full evidence
  remains available in the saved investigation and the model's evidence contract.

## Acceptance boundaries

Development failure, background jobs, Chinese and English use the same router and
evidence model. Configured model, enabled definition, historical invocation and
fresh witnessed activity are separate assertions. Saved running state is UNKNOWN;
stale/future runtime witnesses cannot establish current activity. Same-time conflicts
are CONTRADICTED; dated changes are transitions. Candidate tests and changed source
hashes do not prove the same failure repaired in the loaded version.

The regression suite drives the existing read-only enquiry through real HTTP typed
approval, sealed order, durable claim, citation validation, saved result and readback.
The model worker and approved-source boundary are substituted in that integration
test; it is not a new live approval or an unattended provider dispatch. Real chat
acceptance separately exercises the subscription, source adapters and saved readback.

PR #64 was verified open and draft on 2026-10-08. Its remote lifecycle is distinct
from subsequent local wiring. This delivery does not merge or close that PR.

Provider billing, complete named live-worker inventory and same-failure regression
proof remain unconnected or unverified. The architecture component stays **partial**.
Acceptance reports UNKNOWN/UNAVAILABLE for those gaps rather than asserting completion.

## Measured checks, 2026-10-08

The affected investigation, architecture and real HTTP enquiry suites passed 113
tests. The canonical source/script/root suite passed 7,127 tests with 5 environment
skips after excluding one existing machine-dependent OAuth credential-shape test.
The initial unfiltered source/script run failed that unchanged test: the local
credential file did not expose the refresh token it expects. The subscription-only
preflight independently returned `subscription_login_required`; an API-key login
is not accepted as a subscription. At that snapshot, live Chinese/English development
and background acceptance was pending Owner login, not reported as passed. No
credential or authentication implementation was changed to make the test pass.

## Subscription acceptance after Owner login

Owner completed CLI subscription login on 2026-10-08. The real bridge preflight
reported Claude subscription billing; the previously failing OAuth-shape check
then passed unchanged. The unfiltered canonical suite at implementation commit
`d2701cf35e80aa0f8f70009a2b2e24d15fd5e0dd` passed 7,128 tests, with 5 environment
skips and no failures.

All four fresh Owner chat cases at that build used Claude Opus 5.5 / medium.
Invocation receipts recorded four successful Opus calls per case. Each result was
saved and read back with matching response and investigation measurements.

| Case | Duration | Saved run |
| --- | --- | --- |
| Chinese development failure | 40,424 ms | `2f314635-6e8a-48c9-b410-66d8492aac62` |
| English development failure | 40,353 ms | `09264814-c1dd-4571-b790-d222693fd9ef` |
| Chinese background jobs | 36,515 ms | `1a387832-720d-4719-9a17-0fbb8f5b55a5` |
| English background jobs | 44,848 ms | `a2519359-faef-43df-9d10-69526b411941` |

Both development cases selected the same failed task and exact GitHub revision,
kept repair UNKNOWN and gave a read-only recommendation. Both background cases
read configuration, schedules, execution and work; they separated fresh runtime
snapshots from enabled definitions and historical model evidence. No action tasks
were returned. These single-run timings are not a latency guarantee.

The initial harness incorrectly required identical supplemental section arrays
across languages and an execution section for every development question. Its raw
aggregate therefore remains `incomplete`, despite four passed cases. The Chinese
plan additionally requested live_runtime (work/configuration/schedules); English
requested execution_history (work/configuration/execution). The audit checks the
shared mandatory failure/source/test/repair requirements, authorization policy,
closed typed-needs mapping, exact task/revision and evidence semantics. All passed.
The original raw receipt is preserved separately from this audit; no product route
was rewritten to force matching arrays or hide an unavailable source.

Delivery evidence in the owner workspace: `outputs/generalization-live.json`,
`outputs/generalization-acceptance-audit.json`,
`outputs/generalization-full-suite-final.txt`. The in-app checklist retains partial
connection status and displays this bounded acceptance and remaining gaps.
