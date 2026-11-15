# Local answer boundaries

Status: isolated candidate, not deployed or model-accepted. Base is PR167
`bab4356e43ab6bdab588b94789268514c150d38e`. No acceptance allowance is created.

## Retained failure evidence

The Owner's six saved messages contain a fictional transfer question (12 boxes
at one shop, 3 at another, floor 6), a minimum-movement follow-up, and a compound
Codex/offline-capability enquiry. The visible follow-up lost its final balances
to the operational evidence guard. The compound enquiry hit the unsupported
dispatch template before model understanding. Original raw model completions
were not retained: fixture interpretation JSON is explicitly synthetic.

Saved timing receipts report 12,859.0148 ms / 3 completed model calls and
13,248.0416 ms / 4 completed model calls respectively. These are individual
historical observations, not new-candidate benchmarks or population statistics.

## Changes

- The existing closed CodeDiagnosis command grammar still owns explicit
  supported commands and rejects unsupported ones. A capability question or a
  negated command does not become an execution request merely by mentioning
  Codex and dispatch. Local refusals use the existing local Worker restriction.
- Trusted host-local mode adds current Worker/offline limitations to every chat
  prompt, including when the optional planner is off. Implementation, connection,
  authorization and successful execution remain separate. External services
  can need the network even when inference is local. No new worker is connected.
- The existing answer call can interpret a bounded `minimum_transfer` contract
  from host-attested Owner messages. Quotes bind quantities, units, locations,
  the uniform floor and transfer-only restriction; assistant text and browser
  history cannot attest premises. The program computes the deficit lower bound,
  conserves stock, verifies every floor and renders both transfers and balances.
  It never publishes the model's unverified prose as operational evidence.

This contract supports 2–8 locations, nonnegative integer quantities, one unit,
one uniform minimum and unrestricted transfers. Extra quantities, amendments,
unrepresented constraints, missing quotes or infeasibility decline or explicitly
report the shortage. Other arithmetic remains on the existing understanding
path; this is not a general mathematical or business optimizer. It cannot issue
an action. Tests retain rejection of invented actual stock claims.

## Validation and limits

The saved-input fixtures exercise the actual Express router, intake, answer
parser, supplied calculation and final HTTP response with a synthetic adapter.
They assert one answer call, no reads/dispatch and both answers to the compound
enquiry. Module tests reject forged receipts, assistant premises, operand/unit
mismatch, negative stock, later amendments and additional constraints, and check
conservation, minimum movement and infeasibility across allocations. Existing
source guards, local cloud fence, usage boundaries and routing regressions must
also pass in the full isolated suite. Synthetic milliseconds are not model speed.

Real Qwen interpretation, natural language quality, final pixels and timing are
still unverified for this candidate. Deployment and real acceptance need their
own exact-version approval; nine historical ledgers and disabled capture remain
unchanged. No fresh root, model invocation, API fallback or service restart is
authorized by this document. Preserve the existing launcher overlay. Lower
priority stop/draft/history/date UI changes are outside this repair.
