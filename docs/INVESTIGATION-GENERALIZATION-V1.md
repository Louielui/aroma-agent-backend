# Investigation Intelligence v1: generalization

Scope: existing Owner-authorised read adapters only. No management permission,
dispatch, schedule change, email write, model fallback or additional planner call.

The existing Goal Decomposer now declares typed evidence needs alongside its
judged source facts. `generalRouter` intersects those facts with the active
provider's existing authorisation and selects fixed local evidence sections:

| Goal | Required local evidence |
| --- | --- |
| Failed work / repair status | Work metadata, registered file comparisons, saved tests, current configuration |
| Background jobs / models | Configuration, schedules, execution history, work/runtime observations |
| Usage / credit | Execution, configuration, schedules, usage, billing availability |

Extra judged needs may extend these bounded selections. External-only Owner
investigations can enter the same report path without a mandatory local read.
Existing required external reads and the maximum-two-source enriching continuation
remain in force. No matches and unavailable sources are distinct; samples do not
establish global absence. Ordinary non-investigation questions retain their flow.

`evidenceModel` adds canonical assertion-level CONFIRMED, SUPPORTED, CANDIDATE,
CONTRADICTED, UNKNOWN and UNAVAILABLE states to saved reports. Legacy findings
and saved receipt formats remain readable. Each assertion has a subject, facet,
temporal scope, source/record references, observation date and retrieval date.
Historical records without a date do not inherit today's retrieval date.

Configuration does not prove execution. Requested and observed invocation models
are separate. Current live activity requires a recognised runtime witness with
an observation within five minutes of retrieval; stale or undated activity is
UNKNOWN. Same-facet, same-time differences are contradictions; dated differences
are transitions. Conflicting answers are withheld rather than picking a winner.
Candidate passing tests and current file hashes never establish that the same
failure has passed regression in the loaded version. Null test counters stay
UNKNOWN. Failed sources are UNAVAILABLE, not empty successes.

The Owner answer preserves bilingual source-bound summaries, adds same-task source
and test status, and discloses evidence grades and gaps. Complete receipts stay
server-side; model context has at most 24 compact assertions without raw structured
artifact bodies. The architecture checklist keeps investigation partially connected.

Acceptance includes the production intake path with controlled connectors and
models for Chinese/English work diagnosis, background-source selection and an
external-only GitHub enquiry. Dedicated tests cover authority intersection,
selective adapter invocation, all six states, stale observations, null tests,
same-time contradiction versus dated transition and bounded prompts. Live A/B/C
receipt IDs, timings, loaded commit and outstanding gaps are recorded separately
in the delivery evidence; fixture success alone is not live acceptance.

Remaining gaps: provider billing, complete external worker inventory and durable
same-failure regression proof for the currently loaded version. This is a bounded
generalisation across registered adapters, not arbitrary-domain omniscience.


## Measured acceptance, 2026-10-08

Loaded core build `b1e62463a697ff4d996d520076a6531c8c516062` passed the three
unmodified Owner questions through the real Claude subscription intake:

| Case | Time | Saved receipt |
| --- | --- | --- |
| A: previous development failure, Chinese | 74,941 ms | `918cdaac-7a2e-44de-bc75-ca9a8fd5a153` |
| B: background jobs and models, Chinese | 32,909 ms | `51847c01-7963-4b38-9f0a-e04c27d3fc38` |
| C: previous development failure, English | 90,885 ms | `74ead2a5-7821-40d7-9d2a-954fc87cc433` |

A and C selected the same work/configuration/execution sections and the same failed
record. They retained UNKNOWN current repair and did not substitute unrelated
passing tests. B sampled current process observations separately from configured
models and historical executions. All three saved their evidence model and
returned zero action tasks. These are single-run timings, not a latency guarantee.

The core full suite passed 7,104 tests with 5 environment skips. A subsequent
presentation correction lists configured automations whose current activity is
unknown, supplies a concrete read-only recommendation for background questions,
and exposes a planned but unconnected development-record need as UNAVAILABLE.
The final focused suite passed 157 tests. This follow-up does not activate that
adapter, widen permissions or manufacture a repair proof.
