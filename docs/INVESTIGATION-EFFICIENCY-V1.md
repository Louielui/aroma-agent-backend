# Investigation efficiency v1

The first live Owner credit enquiry on commit `55eb85b` took 93,306 ms and six
Claude subscription calls. The main answer call took 43,060 ms and the provider
reported 71,544 cache-creation input tokens. These are observations for one
request, not a benchmark or a charge estimate.

For **cost-focused Owner operational enquiries only**, the answer prompt now
uses the existing bounded fresh scalar reference catalog in place of a second
rendered copy of the full operational receipts. Its deterministic findings are
restricted to cost-relevant kinds; the prompt reports the omitted finding count.
The full receipts and findings remain in the server-side investigation, source
binding, saved result and Owner-facing report. The catalogue is explicitly
bounded and cannot prove absence outside its coverage. Other enquiry focuses
retain their existing prompt path until measured separately.

The invocation ledger labels source-intent, final-verification, public-query
planning and recovery calls. The Owner summary displays provider-returned
direct-input, cache-read, cache-creation and output token counters separately.
Missing counters stay unknown. The selected model's counters do not include a
helper model's counters; neither represents actual billing.

Acceptance requires the same historical-cost question before and after, with
source identities, current versus historical state, uncertainty and read-only
recommendation preserved. The quality gate is more important than a smaller
prompt. A single before/after run cannot establish general latency improvement;
report actual timings and usage counters without extrapolation.

Still unconnected: provider billing, account-wide use, per-email invocation
identity and full executor inventory. Approved management actions remain a
separate stage.
