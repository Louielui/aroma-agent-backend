# Shared read-only investigation findings

Owner operational enquiries now use one presentation boundary for three registered
focuses: cost, a sampled failed development task, and observed background process
state. The finding renderer reads only the investigation's already-authorized
receipts. It neither selects new sources nor grants execution authority. Every
visible fixed finding retains the exact source and record identity in the saved
investigation and expandable chat evidence. The full receipt and source coverage
remain available there.

The cost finding keeps the observed call, one sampled schedule definition and
the unconnected billing gap separate. A work-failure finding requires one
readable work section and one uniquely identified failed record with a recorded
reason; it explicitly leaves repair in the loaded version unverified. Ambiguous,
unreadable or conflicting records, and same-record follow-ups, continue through
the established bounded answer path. The background finding shows observed
process roles, state, configured model and observation time; semantic review
still handles other background claims. General enquiries continue to require
the existing exact-scalar binding and independent semantic review.

When the final answer is entirely the fixed cost or single-failure finding,
the model is not asked to draft `investigationAnswer`, the bounded scalar
catalog is omitted from its prompt, and no separate semantic-review model call
is made. The main model and Goal Decomposer still run; this change does not
claim to remove their latency. A fixed answer never includes unused free-form
model prose. A review remains necessary if no eligible fixed finding exists.

The preceding live cost acceptance took 97,357 ms overall. A separate timing
acceptance measured a 13,468 ms host goal-understanding call and 46,992 ms host
answer call in one 94,514 ms run. These are baseline observations, not a
before/after speed comparison. A new-version live enquiry is required to claim
any response-time improvement. Provider billing, exhaustive histories and
same-failure current-version regression remain outside this capability.
