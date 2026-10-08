# Investigation answer stage v1

Three live readings of the same Owner historical-credit question on the prior
implementation took 93,306 ms, 115,378 ms and 92,366 ms. All used six Claude
subscription calls. The main answer calls took 43,060 ms, 66,771 ms and
45,476 ms, respectively. Those observations identify the largest stage, not a
stable latency baseline or billing total.

The cost-focused, read-only Owner investigation now asks the final model for
scalar-bound `investigationAnswer` claims without also requiring a legacy
`answerPlan`. The latter was used by the generic read-result renderer, but the
cost investigation's final answer already comes from deterministic receipts,
exact scalar binding and an independent semantic review. The final read
decision, source catalog, source binding, reviewer and fallback brief remain.
Other investigation focuses and all ordinary conversations retain the Answer
Plan contract. The route telemetry now reports that this special case does not
force one.

Acceptance must verify the exact request path, saved and reloaded Owner answer,
source-bound claims, withheld unsupported claims, read-only state, billing
uncertainty, and the in-app architecture entry. Provider output counters and
elapsed time are separate observations; neither proves actual charges. The
change is an output-contract reduction, not a claim that total latency improved.

The first loaded acceptance on `5970915` passed: the same question produced a
saved and reloaded read-only result with source-reviewed claims and billing
uncertainty intact. Its answer call took 34,720 ms with 3,576 output tokens,
versus 45,476 ms and 5,409 output tokens on the preceding request. Total turn
time increased from 92,366 ms to 126,433 ms because the goal-understanding
call took 49,855 ms instead of 12,894 ms; source-intent also took 10,051 ms
instead of 4,911 ms. This is one comparison with changing source state and
provider timing. It supports a smaller answer-stage output, not a reliable
end-to-end speedup. No extra automatic retry was introduced.
