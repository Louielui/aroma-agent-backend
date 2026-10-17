# U3-A: one typed discovery-to-detail edge (offline opt-in)

Accepted U2-B baseline: `3886589803eb4f0d8c7eabb4ce8723133022697e`, tree
`41f339791de26887709583a6595c9d1cf32b0681`. Its nine actual answers and exact
references were inspected before development; conflict and payment uncertainty
remain explicit. No material semantic defect was found. This is not acceptance
based on the structural count alone. The external acceptance-check receipt records
the per-case judgment. Production/main remains outside this offline tranche.

## Minimal reuse

Existing `contextBindings` now carries server-owned nominal identity metadata:
normalized Context Pack `sourceId`, the existing get argument name, and exact
source/resource identity type. The U2 descriptor/consent projection is unchanged.
The existing selector and Task runner accept host-only `dependentReads:true`.
Default U2 behavior/schema stays unchanged. This adds no route, tool registry,
planner, memory, background worker, dependency, write or runtime activation.

The opt-in selection schema adds exactly one `dependency` key: null, or
`{from:0,id:<existing get tool>,result:"sourceId"}`. A non-null edge requires exactly
one initial list/search plus one get with the same nominal type, source and
resource. No argument, scope, literal ID, additional step or nested edge is
accepted from the model. Literal get/folder identities in initial model calls
are refused in this mode. Existing server argument validators remain authoritative.
There is one initial model selection, not a result-driven planner.

The exact issued selection remains a single-use, privately cloned token. Discovery
must have complete, untruncated scope and exactly one returned row. Multiple rows,
including duplicate identities, or incomplete discovery cause clarification;
no ranking, automatic choice or background continuation occurs. An empty complete
result means no match within that returned scope, never global absence.

The server extracts the normalized row's actual `sourceId`, validates its source,
trust and target argument, and durably binds target ID/arguments/type to the first
pack SHA256. Document prose, titles, URLs and nested fields cannot replace the ID.
Both source leases and host identity/surface/conversation/authorization revision
are checked around every read and after each boundary callback. The target read
must return exactly the same identity; unavailable, empty or mismatched details
cannot become fabricated source content. Each attempted read carries an existing
gateway audit and Browser Read/Run timeline evidence.

Successful details flow into the existing U2-B bounded scalar catalog, exact
binding and subscription semantic review. Missing/ambiguous details instead return
a host-authored limitation/clarification; discovery text cannot substitute for
the unread content. U1 Task/Goal/attempt, consent, replay and cancellation contracts
are unchanged. Step completion never completes the overall Owner goal.

## Verification and interpretation

`node --test src/intake/toolSelection/*.test.js` covers contracts and integrated U1
execution with simulated model proposals. These are not semantic-model evidence.

`node scripts/u2/dependency-demo.cjs <new-directory> <absolute-codex-executable>`
uses GPT-6 Astra / high through the existing ChatGPT subscription client with
credits forbidden and tools/MCP/hooks/apps/memory disabled. Business data, Owner
identity, access leases and persistence are synthetic disposable fixtures.
Discovery holds index text only; amounts/brewing facts exist only in get results.
Fresh random source IDs are generated inside the fixture and never shown to the
selector. The same code handles Drive and Aroma; there is no per-goal workflow.

Cases A-H include separate missing/unavailable detail cases, duplicate submission,
actual U1 cancellation, and controlled host revocation between reads. Initial
selection is model-backed for every case. Successful content answers also have
real model-backed draft/review. Clarifications and blocked/cancelled cases are
explicit host replies or no released answer, not falsely labeled model prose.
Exact packs are captured as fixture evidence even when later revocation prevents
their release in the Task result. No semantic failure is retried within a run.

## Limits before U3-B

There are at most TWO total reads in a dependent workflow: one discovery plus
one detail, one edge, no loops/retries/replanning or writes. Existing independent
U2 reads remain available without a dependency. Ambiguity requires a new explicit
Owner decision; this slice does not add candidate-picking continuation UI or
automatic reconciliation. A complete result is only complete within its declared
source scope; incomplete real adapters conservatively refuse dependent dispatch.
In particular the existing Aroma get implementation filters a bounded snapshot;
offline success does not establish a live direct-record API or global coverage.

U2-B size limits, mixed-language framing and fallible same-model semantic review
remain. A source ID proves lineage, not document truth or unchanged source contents
between reads. Uncooperative transport cancellation cannot prove an independent
external process has stopped; no such containment claim is made. Production host
auth/sharing bindings and live source behavior are unverified and not activated.
U1 deferred criteria, Option B BLOCKED/bootstrap NO-GO and all historical UNKNOWN /
NOT PASS evidence remain unchanged. Stop for Owner review; no U3-B or deployment.
