# Host work / run / usage trace v1

## Connected scope

Existing mail analysis, mail indexing, general memory indexing and consolidation
generate an opaque revision-scoped work ID, a UUID per host run, a host attempt
ordinal, a closed phase/kind and the canonical opaque record ID. No prompts,
email bodies, subjects, mailbox addresses or paths enter the invocation ledger.
The canonical result checkpoint retains the same trace. Reconciliation with an
already stored memory document does not invent a new model invocation.

The subscription adapter carries host AsyncLocalStorage context, never a trace
from model output or input text. The authenticated bridge records trace before
dispatch and strips it before calling the provider. Each invocation ID remains
one provider-call attempt. Multiple model phases in one run are not retries.
Identical invocation receipts count once; conflicting invocation/run identity
is withheld. Distinct host run IDs count separately, even if their attempt
ordinals were reset by an existing explicit retry/rebuild command.

## Hindsight boundary

The existing fixed Hindsight HTTP adapter forwards signed metadata in a header.
The repository-owned Python launcher wraps ASGI context and the installed SDK's
request builder. Only authorized memory POST requests with one valid signed
header can forward context to the fixed local bridge completion URL. Different
ports, cloud destinations, missing/invalid/duplicate headers stay unlinked.
Headers never reach model prompts or upstream providers. Third-party packages
are not edited. This launcher runs with one worker; background consolidation
remains disabled. No global occupied-slot or timestamp correlation is used.
Uninstrumented, asynchronous queued, external or legacy callbacks without
transported context remain unlinked. Old records are not backfilled.

## Results, retries and limits

After a canonical checkpoint commits, the host may report the outcome to the
existing bridge ledger using matching work/run identity. This is a *host
checkpoint report*, not independently verified execution/adoption or billing.
The endpoint cannot create a new invocation, invoke a model, update an active
invocation or overwrite a conflicting result. Receipt update failure leaves the
outcome unknown without retrying the original task. Model success, host outcome,
usage coverage and billing retain separate evidence states.

The ledger remains bounded: up to 256 retained invocations and 24 read receipts.
Counts and usage are observed samples, never full-job totals. Retry runs report
host ordinals >1, not total retries across missing history. A failed/interrupted
call can consume unobserved tokens. Last-turn and cumulative usage are not added
as if they were full invocation counters. Billing remains unconnected.

This slice does not link development workers, external schedules or third-party
apps, add jobs, change intervals/models/quotas, or grant new management rights.

## Acceptance

Exercise canonical mail analysis and memory indexing through existing services;
verify canonical checkpoint trace equals bridge receipt identity. Exercise the
installed ASGI/OpenAI SDK boundary with authenticated context, concurrent calls,
failures, cloud/nonlocal destinations and duplicate headers. Verify read-only
investigation consumes the saved receipts in both languages with exact sources,
unknown coverage and unconfirmed billing. Loaded natural background receipts
are checked separately; offline evidence does not stand in for runtime proof.
