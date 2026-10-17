# U3-C: one evidence-aware cross-source investigation

Baseline: U3-B `a28746fcd1c9e0d135e9c4041103f99571a1b160`, tree
`119dd40c5fbc25db8746f77a3f8030a6f970e638`. Host opt-in only, false by
default; no runtime registration, route, permission, connector or UI change.
Production remains BLOCKED. Option B and historical UNKNOWN / NOT PASS are unchanged.

## Reused boundaries

The existing U1 Task/Goal/Attempt, Main Owner router, consumed Browser Read consent,
Task lock/CAS/idempotency and Run Timeline remain authoritative. U2 semantic selection
starts a U3-A same-resource discovery/detail edge. Existing Context bindings advertise
actual resources and validate arguments; the existing Tool Gateway performs reads.
The original Task/Goal is never replaced by the selector's interpretation.

One additional model proposal selects an advertised search in another source, using
an exact string field or contiguous substring in the actual Source A detail. This is
a typed evidence-to-search dependency, not a new registry or planner. The host checks
the closed proposal shape, permitted source, current availability and lease, string
length/control characters, evidence value and actual server argument validator.
There is no model-supplied get ID: one registered matching get is bound by the existing
typed dependency to the unique actual Source B discovery sourceId. A WeakMap binds the
handoff to an unmodified execution actually produced by this selector instance; the
handoff is consumed once. No arbitrary loop, retry, conversion, write or fallback.

Source-content sharing requires the existing separate host synthesisSharing decision,
not providerSharing alone. Both source leases, current authorization identity/revision,
session and cancellation are checked across reads and synthesis. A query is only data;
matching names or references never create a source grant or transaction identity.

## Read and clarification budgets

Unique Source A discovery/detail + Source B discovery/detail = at most four reads.
Events are committed before each dispatch in the existing Browser Read receipt.
An incomplete Source B discovery cannot establish uniqueness; unavailable and empty
results stop without retry or an invented detail ID. No global absence claim follows.

For multiple Source B candidates, the existing U3-B continuation persists the exact
ordering, source scope, candidate fingerprints and original evidence hash. Its minimal
typed metadata extension records a two-pack Source A prefix, initial count three,
maximum count five and exactly one freshness read. Source bodies stay in the original
Browser Read receipt, not Task metadata. The authenticated Main clarification response
atomically claims the same Task/Goal under CAS/idempotency. At most one fresh Source B
discovery and one detail are admitted by the existing authoritative Task Store, making
five reads over both attempts. Ambiguous replies cause no reads; stale or replayed
replies cannot buy another budget. Origin receipt corruption, changed candidates,
revocation, cancellation and uncertain cross-store commits remain fail-closed. Restart
never executes a waiting task. Current Source A authorization is checked during the
Source B continuation; its old snapshot is not silently represented as a new read.

Bounded limitation: if the initial Source A discovery is ambiguous, the existing
three-read U3-B clarification can finish only Source A. This slice does not append
another cross-source branch after that continuation. The answer explicitly reports
that no handoff happened and requires a fresh explicit investigation. A second
clarification phase or unrestricted replanning is not implemented.

## Grounded answer and presentation

The four complete packs remain evidence, subject to the existing 36k per-pack and
108k aggregate presentation budget; omitted packs become explicit hash-only receipts.
Only Source A detail and the last actual Source B pack feed the existing U2-B synthesis.
No extra synthesis source-count allowance is needed: at most two sources use the
unchanged six-record/18k scalar catalog and 12k report budget. Omitted content cannot
support facts. The existing subscription semantic review and scalar binder are retained.
Cross-source observation claims must cite only one section; mixed-source observations
are withheld. Separate supported source observations can form one useful answer.

The host always states that search leads are possible relationships, not verified
transactions, and that currency/tax/scope/linkage are not fully verified. No arithmetic
or financial variance implementation is added. Quote amounts and invoice amounts are
reported separately with exact attribution. Payment completion, current Price Book
prices and item-level comparisons remain unsupported. Synthesis and its reviewer are
fallible model interpretation, not a mathematical entailment or business-truth proof.
Read completion never completes the overall Owner Goal.

## Verification and boundaries

`crossSource.test.js` covers four-read lineage, reverse-direction reuse, invalid query
and tool proposals, sharing, permission revocation, cancellation, ambiguity/freshness,
same Task/Goal, replay, persistence damage and restart. Contract fixtures use scripted
model proposals and are not semantic acceptance. `scripts/u2/cross-source-demo.cjs`
separately records actual GPT-6 Astra / High / ChatGPT subscription calls with synthetic
sources only; it uses the existing restricted text-only client and disallows API credits.
Final acceptance inspects actual answers, source references and missing-information
handling, not just aggregate counts. Independent Claude review is separate.

No Aroma System server/schema or Context monetary projection is changed. Missing
upstream tax treatment and transaction linkage are retained as unknown. Owner selection
is not approval, and Owner association is not a verified source relationship. No new
production baseline, service operation, remote push, PR, merge, deployment, paid API,
background work, live business read or U3-D is authorized by this slice.
