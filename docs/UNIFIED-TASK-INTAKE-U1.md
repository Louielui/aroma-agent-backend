# U1 initial shared intake integration

This default-off initial slice uses the existing Task Store lock/writer, Owner Goal
contract, Browser Read validation/consent/controller, contextTask bounded read
planner, and Owner web authentication. `UNIFIED_TASK_INTAKE=true` opts new V2
Browser reads and the explicit Main shared-task button into one reservation seam.
It adds no model loop, executor, registry, source grant or approval mechanism.

Chrome tasks appear in the existing Main Browser Work panel. “View task in Main”
only reads the common projection. Explicit continuation repeats the immutable
objective in a fresh bounded read attempt with current provider/source scope and
unavailable browser context. Changing the objective requires a new task. Prior
page text, source authority, session credentials and action nonces do not travel.
Ordinary Main conversation and specialized handlers remain on their legacy paths;
they are not claimed as unified. Main shared tasks use the same existing bounded
read runner as Chrome, rather than recreating an Owner Goal in intakeService.

Reservations create no business Decision. Exact retries return the prior linked
attempt without model/source dispatch. An unlinked reservation is interrupted and
requires explicit recovery. Revisions serialize continuations; a current active
attempt must be stopped through its existing controller first. Main continuation
of a browser job does not send cancellation or approval to the native transport.

Main records are refused through native get/read/cancel/retry/ancestor access.
The service bearer token cannot call the Owner-session task projection endpoint.
Chrome projections expose only that Chrome record and its execution reference,
even after Main creates another attempt. Task/conversation linkage contains no
page bodies, email, provider tokens or portable permission leases. Owner request
text remains in the existing goal and conversation stores under existing policy.

Execution `finished` and complete source coverage never imply `GOAL_COMPLETED`.
This slice introduces no full-goal completion verifier. Every mandatory clause and
blocker remains visible. Unsupported actions, scheduling, Gmail preview and Gmail
writes are not mapped into this runner. A pending E1 implementation is not loaded
or copied into U1. Native V1/V2 shapes, protocol version, packaging dependencies,
source freshness checks and consent remain unchanged. No new Native Host request
can import Main history. Default-off admission also blocks execution of reserved
U1 jobs, while retaining their observational reads.

## Design acceptance accounting

The completed architecture audit and design (27 criteria) were read and their
source anchors/hash verified before edits. This is an initial vertical slice;
the table records its limits rather than declaring all design criteria accepted.
The synthetic integration tests exercise the real Task Store, Browser Read,
contextTask, Drive search/get planner, conversation store and Express auth route.
Browser tests exercise assembled UI with synthetic HTTP responses, not live data.

| Criterion | Initial-slice evidence and remaining scope |
|---|---|
| C01 | Exact objective, mandatory clauses, 08:00 and no-checkout survive reservation. Same text alone never merges tasks. |
| C02 | Same submission/payload reuses task/attempt; changed payload conflicts; route retry saves no second turn. |
| C03 | Closed envelope rejects client role, capability, receipt and unknown version. |
| C04 | Existing contextTask treats source instructions as data; only registered read operations are reachable. |
| C05 | Real bounded Drive search then get; unrelated general question makes no source reads. |
| C06 | Existing Browser Read source identity/freshness regression tests retained; Main carries no source authority. No Gmail identity implementation in U1. |
| C07 | Source revocation during read discards result. Existing domain/provider-sharing tests retained. |
| C08 | Old attempt scope remains frozen; continuation captures current available scope. No capability activation is introduced. |
| C09 | Chrome-to-Main shares task/goal and blockers; new attempt, no history merge or browser grant transfer. |
| C10 | No action is dispatched by this slice. Existing Gateway session/hash/nonce tests retained; unified action handoff deferred. |
| C11 | Existing Browser cancel aborts controller; late callback cannot publish success. No U1 action supersession added. |
| C12 | Restart interrupts; retry is observational. Missing reservation/link/receipt stays interrupted/unavailable. Full cross-domain recovery deferred. |
| C13 | CAS permits one concurrent continuation; stale revision conflicts. |
| C14 | Mismatched or missing domain linkage is unavailable; no receipt kind can complete a goal in this slice. Positive full-goal verifier deferred. |
| C15 | Partial read coverage and all unresolved outcomes remain visible in common projection. |
| C16 | Finished investigation/answer remains distinct from completed Owner goal. |
| C17 | Original multiclause/time/no-checkout instructions retained; Costco/scheduling execution remains unavailable. Full procurement integration deferred. |
| C18 | Legacy unlinked paths unchanged; default-off prevents new admission and linked execution, without legacy fallback. |
| C19 | Reservation/link failure dispatches nothing; history-save failure is disclosed; missing domain record never becomes empty success. |
| C20 | E1 synthetic compatibility passes with U1 on and off. V3 preview stays unlinked; exact Gmail identity is refused on V2 and as portable Main context. |
| C21 | New truth-store events contain IDs/enums/time only; existing runner stages drive progress. No invented work percentages. |
| C22 | Existing legacy truth-store writer preserves optional U1 metadata. No migration/backfill or archival rewrite. |
| C23 | Directory survey establishes one reservation seam for the two opted-in bounded-read entries. Other specialized Main handlers remain unconnected. |
| C24 | Unknown version/ref/ownership fails closed; unsupported completion remains blocked. No generic receipt-state mapper. |
| C25 | Real route denies service bearer/cross-origin access; native cannot fetch/cancel/use Main records as ancestors. |
| C26 | No new request version or packaged dependency; legacy native/package/frame tests retained. Negotiated expanded transport is deferred. |
| C27 | One Task Store task/goal, no false Decision, browser domain run linked before dispatch, Main conversation references exact attempt. Other domain handlers deferred. |

## Delivery boundary

The original U1 candidate and receipts are preserved. Integration starts from
`f3967c838dab085ff41fee3dd6bb574fddc72ea7`, after the separately approved E1
deployment. See `U1-E1-INTEGRATION-ACCEPTANCE.md` for all 27 status decisions.
Development remains isolated from `main`. Tests run with fresh stores and
credential-free environment; no live company source is read. The in-app architecture
inventory marks this capability partial, default-off and offline-tested only.
Independent source review and full-suite receipts are retained outside the source
tree. No ordinary promotion coordinator is run because it shares E1 journals and
can merge/reload. This Owner-directed tranche stops before merge/deployment.

Disabling the admission switch preserves records and receipts. Rollback does not
delete tasks, downgrade consent, replay an attempt or rewrite goal membership.
