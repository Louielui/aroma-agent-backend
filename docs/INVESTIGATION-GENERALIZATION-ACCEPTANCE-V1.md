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
is not accepted as a subscription. Live Chinese/English development and background
acceptance is therefore pending Owner login, not reported as passed. No credential
or authentication implementation was changed to make the test pass.
