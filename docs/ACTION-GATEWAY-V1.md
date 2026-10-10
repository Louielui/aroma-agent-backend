# Action Gateway v1: single reversible local schedule action

Only `scheduler.pause` / `scheduler.resume` for root `AromaXiangXiang-ErrandRecall`
and dedicated `\AromaXiangXiang\ActionGatewayAcceptance`. No command, task path,
account, shell, service, memory, Gmail or database mutation is model-controlled.

Owner route `/action-center` -> authenticated `/api/v1/scheduler-actions` ->
authenticated local bridge `/scheduler-action` -> fixed Windows adapter.
Background investigation replies show an inline action panel. Inspect is read-only;
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

## Conversation handoff

`/api/v1/demo/scheduler-actions` rechecks that the completed read-only background
receipt belongs to this conversation and is referenced by its saved assistant
turn. Proposals seal both IDs with the exact Windows snapshot. Chat approvals,
get, list and rollback enforce that binding; the generic center refuses to execute
chat-bound proposals and refuses chat operations. Switching topics never approves
anything. Reopening reads the bound runs; nonces stay in bridge memory, and restart
or expiry requires a new inspection/proposal. No nonce is saved in the transcript.

Explicit Chinese/English pause/resume requests naming one registered exact task
can prepare a proposal before any model call. Broad duplicate enquiries continue
through the existing investigation pipeline. They never automatically propose a
pause based on task existence: duplicate state remains UNKNOWN. The Owner may
inspect and explicitly select one registered task in that saved investigation's
panel. This is a bounded handoff, not general autonomous duplicate diagnosis.

Overall connection is PARTIAL: registered actions have a reachable approval
surface; actual duplicate-execution diagnosis, arbitrary inventory and other write
adapters remain unconnected. Real Windows acceptance must be measured separately
from fixture/HTTP tests; if unavailable, report it as pending, never as passed.

## Evidence-to-recommendation handoff

Background investigation panels now automatically ask the host for a fresh,
read-only assessment of the two registered tasks. This remains a bounded source,
not an inventory of every Windows/Codex/backend job. Arbitrary names or model
prose cannot select a target or supply duplication evidence.

The fixed Windows reader hashes Actions, Principals and Settings (excluding only
Settings/Enabled), plus enabled exact CalendarTrigger XML. Unsupported triggers,
random delay or variable-bearing execution definitions produce unavailable
comparison evidence. Identical action/condition hashes and overlapping trigger
hashes establish redundant *configuration*, not duplicate execution or charges.
An entire-task pause is recommended only when all of its enabled triggers are
covered by another registered, enabled, idle task. Partial overlap and mere
similarity produce no pause recommendation.

`recommend` and `prepare_recommended` require the same saved investigation and
conversation as other chat operations. The latter rereads both tasks and seals
the exact recommendation, retained target and evidence hash with the proposal.
Approval locks both registered targets and checks the retained task again before
dispatch and after target read-back. Drift or missing evidence refuses action;
lost coverage after a side effect is outcome_unknown, never a claimed success.
External administrators can still change Windows tasks outside these gateway
locks; the read-back detects observed drift, not an atomic Windows transaction.
Rollback is a separate exact inverse requiring fresh Owner approval.

Positive recommended-action acceptance uses isolated scheduler fixtures. Live
Windows acceptance reads the unchanged registered tasks and must not manufacture
a production duplicate or relabel absence of evidence as success.
