# Investigation decision advice v1

Registered read-only operational investigations now produce an evidence-bound
decision-support projection after evidence grading. It offers at most two options,
a preferred first step, exact observed targets, source references, expected benefit
and tradeoffs/unknowns. Chinese and English use one selector and fixed bilingual
presentation. No additional model call, source read, write, test execution, approval,
schedule change or dispatch is performed by the recommendation layer.

## Connected scope

- Cost: prioritize purpose review only for exact-identity confirmed execution and
  measured positive usage; otherwise first complete identity/usage receipts. Keep
  account usage, job receipts and identity-linked billing separate. No price,
  savings, unnecessary-work or duplicate-execution inference.
- Failure: follow the uniquely selected work identity, not an unrelated successful
  task. Loaded component verification stays bounded, never a global repair claim.
- Background work: prioritize observed active components only with fresh canonical
  runtime witnesses; enablement alone selects an execution check, not a stop.
- Conflicts take priority over proposed remedies. Unavailable/unknown source gaps
  remain distinguished. Missing sources do not acquire fabricated record citations.

`evaluateInvestigation` exposes `decisionAdvice` for consumers. Intake recomputes
it after continuity and cross-source reads, and displays it after final concise
brief selection. Saved reports retain structured choices and exact references.
Old saved reports and existing legacy recommendations remain compatible.

## Remaining limits

This is bounded decision support for registered evidence facets, not arbitrary
business remedy generation. Work usefulness, complete external inventory, automated
Claude quota, per-job charges and quantified savings remain unverified/unconnected.
Action Gateway and management permissions remain deferred. An Owner confirming a
recommendation does not enable a new action route in this slice.

## Verification

Run `node --test src/investigation/decisionAdvice.test.js` and the decision advice
intake cases in `src/intake/operationalInvestigation.test.js`. They cover exact
usage references, zero/missing/unlinked/conflicting receipts, task identity,
stale-vs-current runtime, bilingual source-prose isolation and the real intake
response including brief replacement, with no extra provider calls or dispatch.
