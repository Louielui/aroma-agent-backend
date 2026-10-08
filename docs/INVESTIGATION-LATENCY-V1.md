# Read-only investigation latency boundary

Three previous live Owner enquiries took 56,292 ms (cost), 168,360 ms
(development failure) and 102,578 ms (background work). The subscription
invocation ledger attributes 110,982 ms of the failed-task enquiry to a
failed advisory intent call before the Goal Decomposer ran. That observation
does not identify provider billing or establish a typical response time.

The conversation-route semantic fallback now passes one 30-second abort signal
to its two advisory opinions. If an opinion stalls and honours cancellation,
the fallback fails closed: it does not authorize an automatic source read, and
the existing Goal Decomposer and investigation path continue. The main answer,
source reads, evidence review and any approved work retain their own limits.
Normal classifier replies are unchanged; this does not skip the classifier or
weaken the two-opinion consensus requirement.

The deadline bounds only this optional stage, not the whole enquiry. A provider
may still consume subscription usage before an abort. The bridge has its own
single-flight and provider latency behavior; a client abort is best-effort.
Real response-time improvement needs a new-version live measurement, with the
same question and its invocation receipts, after loading the service.

## Source-bound answer call

A fresh Owner investigation can skip the main answer call only after the Goal
Decomposer supplies a usable evidence-first or provisional diagnosis/retrieval
frame, all required facts map to the authorised Xiangxiang operations source,
that source returns readable records, and the server can render a cost or
development-failure answer with exact receipt references. The saved response
retains its source references and uncertainty. It records that the answer call
was skipped; it does not claim an answer model produced the fixed text.

Missing frames, mixed-source requirements, requested actions or capabilities
other than the already fulfilled `xiangxiang_operations.read`,
follow-up comparisons, unavailable records and general semantic investigations
still use the established answer path. A fresh background inventory may now
skip the main call and semantic review when its bounded live configuration
rows have unique identities and the plan names only local operations. The
prior 95,838 ms background enquiry spent about 37,471 ms on the main answer
and 13,368 ms on evidence review; those are measured opportunities, not a
guaranteed saving. Final knowledge
and source-intent gates remain in place. This removes the observed redundant
main call, not all provider calls: intent classification, goal decomposition and
final gates may still use the selected subscription. New-version timing and
quality must be measured live rather than inferred from the earlier 70-second
sample.
