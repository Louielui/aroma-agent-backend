# Independent bounded acceptance entry

## Scope and status

This candidate extends the existing Action Gateway and usage-budget store. It
does not deploy, create a ledger on installation, call a model, change credentials,
alter P02-C, or reset/close/reuse the paused latency acceptance root. Offline
transport tests use provider substitutes and are not real-model acceptance.

The one inert definition is `6181f0ad-90d7-4c89-9886-39671ce75a05`: one turn,
at most six helper attempts including failures/retries, zero website calls,
Claude Opus 5.5 / medium through the existing subscription only. This is a
proposed allowance, not an activated grant. It requires separate exact-version
deployment approval and explicit Owner acceptance authority.

## Existing authenticated entry

After approved deployment, technical readback, Owner login and acceptance
preflight, send the following through the existing authenticated scheduler-action
path. The browser-facing Action Gateway retains Owner authentication and
same-origin checks; its Bridge transport retains the existing bearer check.

```json
{
  "op": "usage_acceptance_activate",
  "rootId": "6181f0ad-90d7-4c89-9886-39671ce75a05",
  "predecessorHash": "<approved hash of JSON.stringify(old stored row)>"
}
```

The predecessor is `f1d1f674-3820-4619-85ed-3b8fdeb01e98`. The hash uses the
existing Action contract hash, independently of the byte-level SHA-256 retained
in deployment evidence. The old root must be paused with no unfinished turn,
child or unresolved reservation. Every new-root read/mutation validates the
stored predecessor binding. Unknown roots, extra fields, drift, a busy shared
Bridge, replay, or an existing new root refuse. Old and new locks are acquired
in fixed order for mutations; selector reads participate in the same lock to
avoid Windows destination-file rename races. No old ledger bytes are written.

Before activation the resident facade exposes the old paused status for
compatibility, but refuses all old-root mutations. The explicit new operation
alone can activate the new definition. Resident backend and Bridge instances
resolve the shared persisted selection on every call. Once present, the new
root remains selected across restart, pause and close. Generic `usage_activate`
cannot reactivate it. An interrupted/failed acceptance requires inspection and
another explicit decision, not automatic resume or a replacement child/root.

## Dispatch and accounting

The ordinary `usage_bind_turn` and `x-xiangxiang-usage-turn` intake binding remain
required. Signed Bridge scopes, native provider permits, conservative durable
reservations, evidence capture and retry/child accounting are unchanged. Scope
must belong to the new root. Wrong/missing scope refuses before dispatch; the
seventh helper and first website call cannot be sent. Persistence failure fails
closed. Process exit does not refund unfinished reservations or reset counts.
API fallbacks and unapproved model/effort selections remain blocked.

The sole proposed real case replays the saved "latter reference correction plus
two sentences" conversation against formal memory. It must preserve the verified
answer through classification/guard arbitration without business reads or writes.
Capture input, raw answer, classifier/verifier and guard decisions, final visible
reply, calls and segmented wall time. Expected calls are four; six is a hard cap,
not a target. Stop at the first substantive/ambiguous failure, scope mismatch,
or cap. Restore the prior automatic-memory setting after stopping/completing.
Do not infer general latency, two-record recall regression, or branch coverage
from a single successful visible answer. The combined Owner package supplies the
exact source/version, expected answer, old-byte hash and execution preconditions.

## Offline evidence

`src/actions/independentAcceptanceEntry.test.js` exercises inert/replay behavior,
strict root/model/binding, predecessor drift/unresolved work, persistence failure,
restart, child and concurrent accounting, two Node hosts, the actual Bridge and
Action Gateway, the actual intake route and the resident `owner()` selector.
Existing subscription/native-budget tests remain required. All provider sends
in these tests are substitutes; subscription review and live acceptance receipts
must be reported separately. Source installation alone is not acceptance.
