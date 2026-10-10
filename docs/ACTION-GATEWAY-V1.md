# Action Gateway v1: single reversible local schedule action

Only `scheduler.pause` / `scheduler.resume` for root `AromaXiangXiang-ErrandRecall`
and dedicated `\AromaXiangXiang\ActionGatewayAcceptance`. No command, task path,
account, shell, service, memory, Gmail or database mutation is model-controlled.

Owner route `/action-center` -> authenticated `/api/v1/scheduler-actions` ->
authenticated local bridge `/scheduler-action` -> fixed Windows adapter.
Background investigation replies link to the center. Inspect is read-only;
existence is not proof of duplication. Unavailable remains unavailable.

1. Fresh exact inspection, with source and UNKNOWN duplicate verdict.
2. Recommendation binds target, capability, original enabled state, exported task
   definition hash (only Settings.Enabled normalized), expiry and inverse action.
3. Structured Owner approval, exact hash and one-use nonce. Restart invalidates
   outstanding authority. Natural language and model output cannot approve.
4. Durable target lock; approval and dispatch saved before side effect. Fresh
   preflight refuses changed definitions/state, running/queued/unknown tasks.
5. Fixed Windows mutation also checks expected hash/state immediately beforehand.
6. Separate uncached Windows read verifies identity, definition, enablement and
   idle state. Worker success is never sufficient. Read-back/reply loss is
   outcome_unknown and cannot be automatically retried.
7. Rollback creates a NEW inverse proposal for the same unchanged task; a new
   Owner approval is required. Timeline links the original run.

Pause disables future triggers, never stops a currently running process.
Insufficient Windows rights fail closed; no elevated broker or ACL grant is
installed. Crash locks are retained for manual inspection; no stale-lock reuse.
Existing email/memory processing and prior failed records are unaffected.

Overall connection is PARTIAL: registered actions have a reachable approval
surface; automatic duplicate diagnosis, arbitrary inventory and other write
adapters remain unconnected. Real Windows acceptance must be measured separately
from fixture/HTTP tests; if unavailable, report it as pending, never as passed.
