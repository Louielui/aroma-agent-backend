# Independent AI-list speed acceptance entry

This definition is inert. Installing or reviewing the source does not create a
ledger, transfer allowance, close a historical root, or start a model call.
Deployment and this exact acceptance need separate explicit Owner authority.

## Existing mechanism and bound proposal

The existing `usageBudget.createIndependentAcceptanceEntry`, Action Gateway,
atomic Action Store, Bridge and native subscription send boundaries are reused.
No alternate accounting store, selection file, credential, transport or model
permission is introduced. The new resident selection is consulted on every call,
including by an already-running backend/Bridge. Previous definitions keep their
exact identities, limits and predecessor material.

Proposed root: `483bd416-3f28-4133-bad7-5493963f4bd0`.
Identity: `owner-ai-list-speed-acceptance-20261110`.
Claude Opus 5.5 / Medium, existing subscription only; one turn, maximum six helper
reservations including failures/retries/children, zero website reservations.
Expected three to four actual helper calls is an offline hypothesis, not a grant
or a measured speed result. All four predecessors must be paused, resolved and
hash-bound in order: latency, memory-arbitration, delegation-list, delegation-retest.
Their bytes remain unchanged. A spent turn or unused old helper is not reusable.

Authenticated `usage_acceptance_activate` requires the exact new root, bound
predecessor hash and existing shared-service idle witness. Ordinary activation,
arbitrary profiles, altered limits, wrong model/effort, missing scope, duplicate
turns, replayed activation, old-root headers, parent drift and unresolved work
remain refused. Restarts cannot reset counts. The seventh helper and first
website must be stopped before transport. Development profiles cannot substitute
for this acceptance. Approval never follows from model or test prose.

## Historical contention failure and test repair

PR153's additional installed offline suite recorded 61 passes and one failure:
two hosts reserved five slots when the test expected six. Preserve that TAP/JSON;
it is not replayed or rewritten by this change. The old test attempted at most
150 immediate reservations per child and tolerated `usage_busy` without yielding.
It could exit normally before reaching the cap. A controlled isolated lock hold
exhausts both original loops with 150 busy outcomes and zero reservations; after
release the same ledger admits a reservation. This proves the harness's progress
assumption is invalid. No historical lock-by-lock trace exists, so it does not
claim every earlier underfill had that exact scheduling history.

Only the test contender changes: a monotonic 15-second deadline, asynchronous
five-millisecond yield after contention, explicit cap confirmation on success,
and visible timeout with reserved/busy counts. Unexpected errors propagate.
The production lock, cap, reservation, dispatch and failure behavior is unchanged.
The three historical independent-entry host tests and new entry use this one
test-only helper. No provider is invoked by it.

Deterministic regressions cover more than 150 busy outcomes, permanently busy
timeout and unexpected failure. Two real Node processes each report at least 151
busy outcomes while a parent holds the ledger lock; release then allows exactly
six combined reservations, no dispatch, no reset and unchanged predecessors.

## Minimal subsequent live acceptance

After exact-version deployment, zero-model checks, personal login and separate
bounded activation authority, use the saved two greeting messages and ask only
`你可以派工的 AI 有哪幾個？` once. Do not include the earlier failed answer or
expected-answer hints. Preserve the original conversation and four old ledgers.
Pause automatic memory during the test and restore its prior state on stop or
completion. Do not dispatch a real Worker or write business data.

Check the model input, raw answer, source-owned field binding, validation/guards,
required gaps, compact foreground and expandable details against the actual read
sources. Distinguish recorded workflow models from tested permissions/connectivity.
Never list background jobs as dispatchable workers or invent missing flags.

Measure server total, each helper/CLI/provider span, source reads, network finish
and first observed final UI separately. Do not sum overlapping spans or call
interception/queue/login time model thinking. Compare with the saved same-question
single case of 69.298 seconds and five helpers. Target at most four helpers and
lower server time while preserving answer quality; one sample is not an average,
P95 or model comparison. Exact render completion is unknown unless instrumented.

Stop on the first substantive/unknown failure, drift, accounting ambiguity or cap.
No replacement run, quota extension, API fallback, credit purchase or P02-C change.
Offline passes and deployed source are not real conversation/latency acceptance.
