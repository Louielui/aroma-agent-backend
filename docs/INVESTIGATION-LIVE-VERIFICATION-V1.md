# Same failure verification: first bounded component adapter

This delivery extends the read-only repair evidence chain. It does not add an
Action Gateway or management permission, and does not change the runtime brain.

## Connected flow

- Owner prepares an existing work order. The bridge measures a baseline using
  the fixed `context-fields-v1` probe for `context-fields-snapshot-v1` only.
- An optional explicit `repairOf` identifies an existing failed work order of
  that exact recipe. It is sealed together with the baseline and approval.
  Titles, similar times and shared parent tasks never substitute for this link.
- Existing separately approved adoption verifies the loaded commit and files.
  It measures and stores the same probe after loading, exactly once. Failure to
  obtain this observation leaves verification unavailable; it does not undo or
  mislabel the separately verified adoption.
- Investigation reads bounded receipt metadata only. It does not invoke probes,
  tests, models for repair, adoption, restart or any external management action.

## Probe boundary

The Owner-gated endpoint `/api/v1/project-work/verification/context-fields-v1`
uses the backend's already loaded `makeContextResult` and `makeUnavailable`
with disposable local values. Eight closed host checks cover snapshot isolation
and unchanged metadata. It accepts no code, paths, query parameters or arbitrary
test IDs. No connector, mail read, subprocess, model call or business write occurs.
`READ_ACCESS=off` refuses the endpoint. Credentials and test exception prose are
not transported into evidence.

Receipts include exact work identity, check implementation hash, source hash,
loaded commit, service boot time and observation time. Current proof requires a
fresh independent configuration observation of that same commit AND boot time,
current matching source bytes, immutable sandbox baseline/candidate tests,
review, explicit correction and adoption. A later restart invalidates the prior
process observation even when the commit is unchanged.

## Evidence semantics

`live_failure_verification=CONFIRMED` means the original failing registered
Context component checks now pass in that loaded service process. The scope is
`loaded_context_fields_component_disposable_values`. It does not prove the
whole development task succeeded or that an email/UI integration was repaired.
The broad `repaired` facet remains UNKNOWN. The Owner brief states the verified
component scope in Chinese and English.

Absent original observations, links, adoption or current version evidence stay
UNKNOWN. Older receipts are never backfilled. Unregistered live adapters are
unavailable. Existing real failed tasks therefore need not become "fixed" merely
because this infrastructure is now connected.

## Validation and remaining work

Controlled acceptance uses the actual component and a shallow-copy regression,
then the repaired module through the application HTTP route. It tests the
positive proof and missing evidence, mismatched versions/boot instances,
tampered checks, unadopted results and read-only consumption. Fixture receipts
are isolated test data, not rewritten operational history.

Other recipes, UI, email and full connector-path probes remain unconnected.
Architecture stays partially connected. New live adapters require their own
bounded checks and acceptance before their outcomes can be confirmed.
