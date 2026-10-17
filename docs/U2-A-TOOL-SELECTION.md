# U2-A: bounded semantic selection (offline, opt-in)

Base: reviewed U1 `cd2f382253283ea53debc3e31d1303ea5f54d9db`, tree
`8ba775e24a6b89778dc1b0687c5bca76984c2c27`. Existing tracked files are unchanged.
Production/main remains outside this work: `4fff4bf7d2d4183698fb3783d054ae7d1916ece0`.
U1 is not deployed. All eight deferred U1 criteria remain deferred. Option B is
OFFLINE VERIFIED / PRODUCTION INSTALLATION BLOCKED; bootstrap NO-GO. Historical
UNKNOWN / NOT PASS evidence is untouched. This candidate does not install or
activate anything.

## Architecture reuse and scope

| Existing component | U2-A use |
| --- | --- |
| U1 Task Store and unified intake | Existing Browser Read runner injection; original task/goal/attempt linkage, explicit consent, replay behavior and Main access boundary. No new executionRef kind or contract replacement. |
| Owner Goal | Original objective retained; attempt-local selection goal uses existing `createGoal`. It does not replace the canonical U1 goal or declare its completion. |
| Self Capability registry | Existing implementation facts/descriptions inform the selector; implementation is never a grant. |
| Context resource factories and read-operation vocabulary | `bindings.js` projects existing resource/operation IDs and descriptions. Existing server validators remain authoritative. Argument hints add discoverability, not execution authority. |
| Capability Policy Engine | Existing Research policy evaluates the original objective before model invocation. Source authorization is independently checked. |
| Capability Router / Dispatcher | Inspected, unchanged: these govern registered worker/development capabilities. The existing agent registry has no Research worker. No fictitious worker or per-application routing rule is registered to force reads through this unrelated lane. |
| Context Services / Read Connector / Tool Gateway | Existing read dispatch, source lease validation, strict argument validation, source normalization, data-only Context Packs, start/end audit. |
| Approval Gateway | Preserved, not bypassed. Registered `work_order.dispatch` returns approval-required with no approval or ticket created. This slice cannot approve, prepare, or execute an action. |
| Run Timeline / Browser Read timeline | Existing Run stages plus durable outer attempt evidence: model input/response hashes, selected IDs/arguments, actual read start/end, Context Pack hashes and terminal bounded-attempt result. |

The selector makes one model call against server-supplied descriptions and at
most three independent reads. It has no keyword routing, result-driven loop,
new registry, planner, memory, scheduler, tool executor, dependency or UI. A
combination is a flat set of reads, not U3 multi-step autonomy. Unknown IDs cannot
be resolved by guessing or dynamically constructing tools. Calendar supports
only the existing today/this_week windows; other periods require clarification.

## Boundaries

The host injects authenticated actor, current surface, conversation ID, permitted
sources, provider-sharing decision and authorization revision. These are trusted
host inputs, never model/HTTP/browser request fields. Production mounting would
require independently verified host authentication and complete authorization
revision binding; no production route is mounted by this change.

Selection exposes no execution permission. Executing requires the exact issued
in-memory selection object, consumes it before awaits, rechecks unchanged host
scope and every selected source lease, and uses the existing Context Service.
An object copy, mutation, parallel execute, principal/surface/conversation change,
revocation, audit failure or cancellation cannot widen execution. An unavailable
read stops without retry or substitution. A selected write is never executed.

Model interpretation is labeled `model_proposal`. A read receipt, empty result,
partial coverage, or completed selection attempt never proves goal completion.
No general answer is synthesized in this slice: `no_tool_needed` is a selection
classification. Source text remains data and is not fed back into the selector.
Page snapshots and previous conversation content are explicitly excluded from
this first runner; this is not live Chrome-to-Main handoff activation.

## Verification and demonstration

`node --test src/intake/toolSelection/*.test.js` runs deterministic contract and
integration tests with **simulated model selections**. They exercise actual U1
Task Store / Browser Read consent, Run Timeline, validators, Context Services,
Read Connector and Tool Gateway against synthetic adapters. They cannot prove
semantic model quality.

`node scripts/u2/demo.cjs <new-evidence-directory>` is an explicit opt-in
**actual model-backed** demonstration. It requires a clean candidate and the
existing Claude subscription login. It checks first-party subscription auth,
uses the existing restricted text-only CLI with all tools, MCP and hooks disabled,
empty settings sources, no session persistence, and an empty disposable cwd.
The existing child-environment allowlist strips API keys and business secrets.
No paid API or business credential is used. Model access uses the existing
development subscription; it does not change Xiangxiang's runtime brain.

Sixteen cases include English/Chinese paraphrases across Aroma System, Calendar
and Drive, a flat combination, ambiguity, no-tool, unsupported calendar write,
approval-required development dispatch, unavailable Gmail/Drive, unsupported
calendar period, instruction injection and unauthorized Native identity. Expected
answers exist only in the evaluator and never enter the model prompt. Every case
has an independent fresh request. No failed semantic case is retried.

The harness runs through U1 `handleMain` with disposable stores and explicitly
synthetic authentication. This tests internal integration, not a production
authentication endpoint. Existing U1 HTTP regressions remain separate evidence.
Business results are generated only by synthetic transport adapters and pass
through real gateways. Their Context Packs retain synthetic provenance. The
inherited adapter `trust:live` vocabulary denotes observed adapter output, not
live external data; the outer receipt and rendered JSON are always labeled
`synthetic_fixture` and the U1 coverage remains unknown.

Each evidence run records candidate commit/tree, tool calls, model identity and
usage, synthetic results and per-file SHA256. Measured results and independent
Claude Sonnet 5.5 review are external, immutable receipts linked to the exact
candidate. Review does not imply production acceptance.

## Before U2-B

Owner review of this slice is required. Remaining gaps include broad semantic
evaluation (especially compound goals), independently verified real host
authentication/provider-sharing bindings, actual source reachability, and the
separate approvals for any production migration or live activation. The existing
Run model is in-memory; the fixture's Browser Read store supplies durable attempt
evidence. No new general persistence service is introduced. Read-only transport
timeouts cannot prove an arbitrary uncooperative adapter has stopped; this slice
does not claim maintenance containment or solve Option B. API keys, production
data, live writes and U3 result-driven coordination remain outside scope.
