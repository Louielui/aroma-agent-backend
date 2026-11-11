# Independent model-foreground acceptance entry

This source definition is inert. Installing it does not create a ledger, grant
allowance, close a previous root or invoke a provider. Exact-version deployment
and the bounded live acceptance require explicit Owner decisions.

## Existing accounting and predecessor preservation

Reuse `usageBudget.createIndependentAcceptanceEntry`, the Action Store and
Gateway, resident Bridge selection and native subscription send boundaries.
There is no new accounting store, transport, credential or approval mechanism.
The foreground profile is selected only after its own authenticated activation;
before then the spent speed root remains selected. Every predecessor must be
paused, resolved and hash-bound in this order: latency, memory arbitration,
delegation list, delegation retest, speed. Their original bytes are retained.
The speed sample's used turn and unused helpers cannot be reactivated, refunded,
transferred or consumed by the foreground profile.

Proposed root: `d4654bf0-3e8a-4991-8c51-81aa34359960`.
Identity: `owner-ai-model-foreground-retest-20261111`.
Model: Claude Opus 5.5 / Medium, existing subscription only.
Limits: one turn, six helper reservations total, zero website reservations.
Failures, retries, children and parallel requests share the same durable cap.
The seventh helper and first website must be refused before transport. Restart
cannot reset counters. Missing/wrong scope, old-root headers, arbitrary profiles,
altered limits, wrong models, activation/turn replay and predecessor drift remain
refused. Existing development allowances cannot substitute for this acceptance.

## Regression evidence and its limits

The new fixture preserves all five predecessor files, including a speed root
with one completed turn and three dispatched helpers. Tests cover exact Owner
activation and idle checks, all five invalid/missing/active/closed/unresolved or
drifting predecessors, child/retry caps, failed reservations, persistent restart,
two real Node contenders, lock release after more than 150 busy outcomes,
persistence failures, authenticated Bridge send refusal, resident selection and
the actual intake route's turn binding and evidence capture. Providers and
connectors in these tests are substitutes, not real model/Worker acceptance.
Production reservation and transport code are unchanged.

## Minimal separately approved live test

Use only the original two greeting messages and ask once:
`你可以派工的 AI 有哪幾個？`
Do not provide the previous failed answer, expected answer or extra hints. Retain
the original conversation; prepare a separately bound conversation/turn only
after approval. Pause automatic memory for the test, then restore and read back
its original state on completion or stop. Do not seed memory or dispatch a real
Worker. The five historical ledgers remain paused and byte-identical throughout.

Expected usage is three helpers based on the previous native case, with a hard
maximum of six. No automatic retry follows substantive or unknown failure, and
unused capacity is not a reason to add calls. The only channel is the existing
Claude subscription, with no API fallback, purchased credits or P02-C changes.

Validate the main visible answer against the actual trusted source read: direct
model names and corresponding workflow roles, shared models distinguished from
multiple AIs, explicit missing model fields, background schedules separated from
dispatchable AI, and defaults distinguished from actual execution receipts,
permission and connectivity. Preserve provider input/raw output, field bindings,
validation, route/offer guard results, final foreground and details under the
same root/turn/request identifiers. Do not use a model grader.

Measure server total, each helper/CLI/provider span, available source-read spans,
network completion and the first observation of the final visible answer. Report
login, queue and harness delays separately; do not sum overlapping intervals or
attribute unmeasured time by subtraction. The PR154 single reference was 42.392
seconds and three helpers with a failed answer; it is a reference, not a passed
baseline or speed promise. Report quality and timing separately. One sample does
not establish an average, P95 or model comparison.

Before activation require the exact reviewed/deployed source and Bridge/client,
metadata-only subscription authentication, shared-service idle, unchanged source
and predecessor hashes, and independently verified pre-send limits. Stop on the
first substantive/unknown failure, drift, accounting ambiguity or limit. Preserve
all receipts and pause the new root without resetting or moving its capacity.
Offline tests and deployment alone do not prove real answer quality or latency.
