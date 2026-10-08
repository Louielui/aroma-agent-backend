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
