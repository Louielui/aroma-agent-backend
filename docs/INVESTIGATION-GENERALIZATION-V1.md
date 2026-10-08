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
