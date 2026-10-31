# Bridge dispatch and latency repair

## Scope and measured state

Candidate branch: `codex/bridge-dispatch-latency`, based on the live backend and
Owner bridge commit `ee5a2659f8259334cc06afd35e9ee63e577a1f5e`.
This is an isolated candidate, not a deployed-runtime acceptance claim.
The registered CodeDiagnosis v1 profile remains limited to eight committed
dispatch source/test files. General tasks, arbitrary paths, tools, business
writes and automatic fallback are not enabled. P02-C is untouched.

## Reproduction and cause

The original conversation `031128a2-8b25-48e3-9ce8-ceffa5d7fd23` produced
investigation `7889ea2a-c5dd-4e0c-b36b-cfdf2dfee4fa` with server request
`753c3c52-d240-44bd-9dd2-d20450544837`. Its intake receipt measured 99,820 ms
and six Claude Opus 5.5 calls; it did not dispatch Codex.

Replaying the same Owner message against the current runtime took 111,883 ms
at the HTTP client, request `6dc6fd3e-da23-4a71-8ec5-c63304ba9aeb`.
The intake receipt measured 106,894 ms. The planner classified the compound
request as a background investigation and read configuration, schedules,
execution and work, followed by GitHub. The existing work-command route was
later in the chat pipeline and its closed grammar did not accept this command.

The footer read `/execution-health` from the Owner subscription bridge. This
established transport liveness, not execution-lane authorization or worker
readiness. The investigation inspected the backend's legacy `AGENT_BRIDGE`
flag, which was off. These are different processes and different meanings;
both reported the same boot commit during this investigation.

The configured GitHub read token exists, but three actual read probes returned
HTTP 401 `Bad credentials`: repository metadata, one commit and a committed
dispatch source file. Invalid credentials are established; expiry versus
revocation is not. No token was replaced or expanded. GitHub is not a dependency
of CodeDiagnosis: its fixed committed blobs are read by the existing Owner
bridge, with before/after version and content verification.

## Changes

- Route bounded explicit Codex read-only commands into the existing versioned
  CodeDiagnosis/Capability Dispatcher before scheduler or general investigation.
  Its fixed work-order goal now includes the dispatch entrances and return path.
  Unsupported Codex requests receive the actual scope limit without a model call.
- Use one status projector for the execution-health endpoint and direct chat
  health replies. Transport, backend/bridge version agreement, read authorization,
  supported capability, legacy flag and busy/unprobed worker state remain separate.
  A ready transport never proves subscription readiness. Preflight on dispatch
  establishes that readiness; unavailable or mismatched versions fail closed.
- Record actual request identity, model, effort, provider usage and monotonic
  phase durations. A persisted `model_requested` event is distinct from the
  bridge invocation's provider-result evidence. Failed counters stay unknown.
- Poll existing authorized work-order reads for real events and verified results
  in chat. Report snippets are bounded; full source, timelines and model receipts
  remain expandable. Read failure never resends a work order.
- Read the eight independent committed blobs concurrently, preserve ordered
  evidence identities, join all children before returning a failure, and retain
  total-byte, secret, source-revision and access checks. The live measurements
  below still used the old bridge executable; no parallel-reader runtime saving
  is claimed before delivery.

The existing Owner/origin fences, capability policy, exact recipe, read-access
checks, source validation, schema/citation validation, cancellation, no-fallback
rule, source recheck and durable work-order store remain in force. General chat
guards and semantic review are unchanged. The fixed diagnosis path already used
structural verification; no general semantic-review switch was disabled.

## Timing and call evidence

| Measurement | Current runtime replay | Isolated final candidate |
|---|---:|---:|
| HTTP result / verified result available | 111,883 ms, no dispatch | 43,333 ms, completed dispatch |
| Initial work-order acknowledgement | none | 15 ms |
| Intake/service measured total | 106,894 ms | 43,301 ms |
| Calls | 6, Claude Opus 5.5 | 1, GPT-6.1 Sol High |
| Subscription preflight | not separately instrumented | 996 ms |
| Approved code source read | none | 737 ms |
| Model call | see table below | 40,683 ms |
| Source recheck | none | 865 ms |
| Retry | 0 in saved plan | 0 |
| Additional investigation read | GitHub, 172 ms | 0 |
| Semantic review | 6,467 ms, one call | not invoked by fixed diagnosis path |
| Final chat status read | not measured | 15 ms, no model call |

The final candidate result was 61.3% faster in this single comparison, while also
doing actual bounded work. Models, task paths and workload differ; this is not a
controlled model-speed benchmark or a general latency guarantee.

The replay's exact bridge-ledger calls, in milliseconds:

| Phase | Duration | New input | Cache read | Cache creation | Output |
|---|---:|---:|---:|---:|---:|
| Intent | 7,920 | 2 | 1,209 | 0 | 154 |
| Goal understanding | 23,455 | 2 | 3,022 | 26,317 | 2,107 |
| Main answer | 37,250 | 2 | 0 | 88,737 | 3,569 |
| Final verification | 12,751 | 4 | 3,344 | 1,993 | 183 |
| Source-intent guard | 5,516 | 2 | 702 | 2,288 | 152 |
| Evidence semantic review | 6,467 | 2 | 729 | 3,369 | 379 |

All six actually returned `claude-opus-5-5`. Model wait totals 93,359 ms;
these durations already contain provider/preflight overhead, not just generation.
Local decision/conversation recall measured 15/4 ms. Operations/tool reads took
3,924 ms plus the 172 ms GitHub follow-up. Nested prompt phases must not be added
to their containing prompt-build duration. The remaining 9,420 ms inside intake
and 4,989 ms outside intake are not separately attributable to routing, memory
gateway, guard CPU or transport from these receipts; they remain unallocated.
The old browser rendering time was not captured, so a before/after UI speedup
cannot be claimed. No tool timeout was observed in this replay.

Final dispatch phases sum to 43,281 ms; the remaining 20 ms includes orchestration,
validation and durable writes. Guard CPU was not separately timed. Direct status
and dispatch bypass the unrelated memory/investigation/model stages by selecting
the already existing fixed capability, not by weakening their checks.
The diagnosis deadline is 120 seconds; remote source reads have a 15-second signal,
and the bridge HTTP socket has its existing 125-second limit. No timeout occurred.

Final provider usage: 24,952 input, 1,972 output, 26,924 total; 0 cached input,
516 reasoning output (a subset, not an extra quantity to add). Subscription
usage is not a dollar charge or P02-C billing evidence.

## Real work-order acceptance

An initial connectivity smoke used work order
`4b00c7f6-7ca7-4368-ad83-a239065f5e5f`, invocation
`ee863d92-676a-4f66-a6f5-da2c7285213d`: 58,462 ms, one Sol High call,
24,927 input and 1,746 output tokens. It exposed the older defect-only goal
wording. This receipt is preserved separately, not overwritten or presented as
the final task acceptance.

Final acceptance used the same original Owner request, with the updated fixed
work-order goal, against the isolated candidate router and real existing 8091
subscription bridge:

- Work order / host model trace: `8bae7ee6-2eb6-401e-ad5a-ceea893c4de0`.
- Bridge invocation: `2cc9ac63-344f-421b-bf1f-2d0a1a6ba81c`.
- Recorded progression: Owner request, policy allow, worker selection,
  subscription check, source read, Dispatcher agent selection/running,
  model request, result validation, source recheck, completed.
- Actual model `gpt-6.1-sol`, effort `high`, route `chatgpt-subscription`.
- Before/after evidence hash matched; supplied finding citations verified.
  Findings remain hypotheses: no test execution or code changes by this worker.
- The candidate chat's status command read the stored same-conversation run and
  returned the verified result. Replaying the original request ID returned the
  same work order, without a second invocation.
- Unauthorized read returned 401 and cross-origin dispatch returned 403.
  The unrelated general-model/scheduler instrumentation recorded zero calls.

Headless Edge then opened the candidate chat and work-order UI using these
persisted real receipts, without another model call. Conversation open to report
display measured 158 ms; work-order fetches measured 2.5/1.4 ms, with no page
errors. This is a readback measurement, not a new provider execution or evidence
of the updated production browser. Screenshots and timing JSON are retained.

Machine-local evidence directory:
`C:/Users/louis/Documents/Codex/local-candidates/bridge-dispatch-latency/`.
`original.json`, `baseline-replay.json`, `baseline-invocations.json`,
`github-probe.json` preserve pre-fix evidence. `final/` contains the final
request, acknowledgement, full work order, model invocation, chat report,
UI receipts and screenshots. No provider credentials are in those artifacts.

## Delivery limits

Full-suite, independent-review, PR, exact-commit authorization, merge and runtime
reload state must be read from the repository promotion record. An isolated real
subscription result does not establish that the formal service has this repair.
The architecture checklist remains partial and explicitly identifies pending
delivery/live-runtime verification. No shared-service restart has been performed
as part of this investigation.
