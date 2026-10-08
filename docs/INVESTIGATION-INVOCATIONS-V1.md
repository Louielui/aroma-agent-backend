# Investigation invocation evidence v1

The Owner subscription bridge persists bounded metadata for its chat and memory
completion lanes to a fixed local file. Each attempt has a bridge-generated UUID,
selected model, role, start/end timestamps and state. An explicit provider-dispatch
hook separates preflight from provider wait/validation. Dispatch is an attempt;
only the client's validated result establishes a completed model response. Failed
calls may still consume usage; restarted pending calls become interrupted/unknown.

Host intake request UUIDs propagate with AsyncLocalStorage and a closed phase
vocabulary (intent, goal understanding, answer, evidence review). Parallel requests
cannot borrow each other's identity. This establishes a request-to-call link, not
an email, schedule, payment or user-intent proof. Memory completion lacks individual
job identity. Direct coding workers, website calls, APIs and other apps remain
outside this ledger. Existing Codex session receipts remain a separate source.

The fixed file is `Documents/AromaXiangXiang/subscription-invocations/ledger.json`
under the Owner profile, following the existing worker-workspace convention.
LocalAppData is unsuitable here: Windows packaged-app virtualization can redirect
the file independently of its parent. Canonical-path checks remain enforced.

Claude's validated modelUsage counters are projected by model, preserving cache
and helper counters separately. Codex last-turn counters retain their provider
basis. Missing is unknown, explicit zero stays zero, and no totals are invented.
Counters from overlapping session/invocation sources must not be added together.
Subscription routing and token counts cannot establish actual credits or charges.

Storage retains at most 256 records; metadata returns the latest 24 with coverage
start and omitted count. Atomic replacement never stores prompts, answers, raw
errors, account identity or credentials. Invalid, redirected or unreadable storage
stays unavailable and is not overwritten. It does not prevent existing inference
from running, but unavailable coverage is reported. There is no historical backfill.

The authenticated loopback `/invocation-metadata` endpoint accepts only `{}` and
works independently of occupied inference lanes. Investigation reads session and
invocation receipts concurrently with separate failure states. Exact request IDs
group observed phases; similar names/times/models never establish attribution.
The cost answer now leads with a bounded bilingual set of receipt findings,
including when model prose is rejected. It reports an observed completed call,
the selected model and output-token field, a sampled current schedule definition,
and the unconnected billing gap when those receipts exist. The detailed recent
call summary and separate provider counters stay in the saved investigation
record. The archived answer matches the visible answer. Billing remains
unconnected and investigation remains read-only.

Latency is measured per attempt, preflight and provider wait; summed call time is
not presented as request wall time. Live acceptance must measure the real enquiry
before claiming any speed improvement. The later shared finding layer skips an
unused semantic review only when a fixed source-bound answer is available; it
does not change model selection or the review of other enquiries.
