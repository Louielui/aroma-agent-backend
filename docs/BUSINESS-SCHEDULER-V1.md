# Business Scheduler V1: daily procurement report

## Release boundary

This candidate is offline implementation only. The feature defaults off unless
`XIANGXIANG_PROCUREMENT_SCHEDULER=on` is explicitly configured in the Bridge.
No schedule, live source read, production reload or deployment is authorized by
these tests. A separate Owner approval is required for those operations.

The only definition is `daily_procurement_report`, definitionVersion 1,
toolScopeVersion 1, every day at 08:00 America/Winnipeg. No general editor,
arbitrary command, new agent framework or in-process scheduler is introduced.
The existing Windows Task Scheduler supplies the durable trigger; the existing
Action Gateway, approval store, Task Store, ToolGateway and execution receipt
store own the work. The source adapters issue only the existing authorized GETs.
The existing chat source package byte ceiling increases from 240,000 to 245,000
for `src/demo/assets/app.js` only, to retain the existing isolated coding and
rollback regressions after adding the approval card. The path registry, secret
checks, protected tests and all other file ceilings remain unchanged.

## Conversation and goal

The original procurement scheduling request is the regression fixture, including
every supplier, daily 08:00, Costco cart and no-checkout constraint. The full Owner
Goal is saved in the existing Task Store and conversation store. The bounded
proposal excludes Costco and explicitly discloses that exclusion; approval of the
read-only schedule never completes the attached cart goal.

Supported examples: `Create a daily procurement report at 08:00 America/Winnipeg`,
the original Chinese request, `查看每日採購排程`, `暫停每日採購排程`,
`恢復每日採購排程`, `撤銷每日採購排程`, `修復每日採購排程`.
Create and resume remain bound to the original conversation. Any authenticated
Owner conversation can propose pause, revoke or paused recovery, bound to the
saved schedule's exact original taskId, goalId and versions. This only reduces
authority and cannot transfer or reissue an active grant. Status can be inspected
from another conversation. These are bounded intents, not a general scheduler.

The normal result card displays the proposal and a disabled approval button.
Only after the server verifies its presentation can an explicit button click or
exact typed confirmation approve it. Proposal, conversation, state, Windows
definition, nonce, session and ten-minute expiry are bound. Restart invalidates
pending approvals. Creation installs the task disabled, reads it back, persists
the scoped grant, enables it, then independently reads it back again. A verified
schedule and a completed daily report remain separate facts. Use
`查看每日採購排程` to display the latest saved report and execution status in
Imagine; this is in-app inspection, without proactive email or push delivery.

## Delegated read authorization

An Owner-approved grant binds taskId, definitionVersion, toolScopeVersion,
definitionHash, approvalHash, grant ID and exactly:

- `aroma.order_planning.list`
- `aroma.suppliers.list`

The trigger authenticates to the Backend as the existing service, not as an
Owner session. Bridge tick dispatch does not synthesize an Owner actor.
ToolGateway sees `role=scheduled_task` and the exact task/scope/grant identity.
It authorizes before and after each read; the workflow checks again before
publication. The existing source flags/key authorization remain mandatory.
Source data cannot select tools, issue commands, approve a proposal or become a
provider instruction. No model/provider is invoked for execution or reporting.

Pause/revoke persist the refusal before attempting OS disable. Revocation is
terminal for this schedule; a pause cannot undo it. Resume needs fresh approval
and a new grant ID, so a paused in-flight read cannot revive after resume.
Existing tasks do not inherit the new capability: legacy goal scope hashes and
the original Action Gateway contracts are unchanged in meaning and fail closed
on scope drift. No Chrome, external application or business write permission
is added. This narrowly delegated local read execution is an explicit new
authorization path; it remains gated and inactive until separately approved.

## Source completeness

Read-only source-code inspection of Aroma System `server/routes/aiIntegration.ts`
found the following existing capabilities, not verified live deployment facts:

- Suppliers: active-supplier GET, no server limit declared by that implementation.
- Order planning: active purchasable ingredients below PAR, a 101-row probe,
  maximum 100 returned, explicit `truncated`. No supported pagination/cursor.
- Neither response currently provides a verified inventory `dataAsOf` timestamp.

The procurement adapter retains all 100 available planning rows and every
returned supplier, avoiding the existing interactive 25-row default. It does not
invent a cursor parameter, follow a supplied URL or change the business API.
If pagination is advertised without a registered continuation contract, it is
disclosed as unsupported. Source-total metadata is retained without inventing
an all-inventory count.

`COMPLETE` means complete **within the registered replenishment query** with
explicit source coverage, no server/client truncation, source timestamps no
older than 24 hours and no more than five minutes in the future, successful
reads and valid uniquely mapped item/supplier/quantity/unit fields. It does not
prove physical stock accuracy or every supplier's unrelated purchasing needs.
Positive decimal strings are preserved without quantity conversion; no pack or
currency conversion is inferred. Unknown suppliers, malformed/duplicate items,
unsupported pagination, stale/missing timestamps or incomplete supplier reads
produce `PARTIAL`; unavailable planning produces `FAILED`. Missing data never
means an empty purchasing requirement. Missing timestamps in the current source
contract are expected to prevent a live COMPLETE assertion. Business-source API
changes are outside this candidate and require separate scope.

## Reliability and recovery

Daily identity binds taskId, definitionVersion and the Winnipeg calendar date.
Atomic persisted receipts plus an exclusive durable execution lock prevent
concurrent and repeated daily reads, including after process restart. Both
successful and failed admitted runs retain their daily identity. No silent
same-day retry or overwriting of a historical report occurs.

Receipts contain scheduled time, actual start/finish, trigger witness, scoped
grant, per-source evidence, completeness, unresolved rows and report. Last
attempt and last COMPLETE success are separate. Windows last-run/exit evidence
is also displayed, covering failures before Backend admission. A Windows exit
code 0 means a report was recorded, including PARTIAL, not complete inventory.

A crash leaves durable locks. Recovery needs a fresh displayed proposal and
Owner approval bound to the exact orphan lock bytes; a live PID is never
removed. An interrupted fixed registration can be recovered only against its
saved original registration receipt and a verified matching fixed definition.
Recovery disables the schedule, closes interrupted runs as FAILED without
retry, and leaves it paused (or revoked). Resume needs another explicit approval.
There is no task deletion, history reset, arbitrary task adoption or hard reset.

## Time and host requirements

Calendar calculations use Intl America/Winnipeg; tests cover both DST changes.
The fixed Windows daily trigger uses local 08:00 and is admitted only when the
host zone is `Central Standard Time`, matching Winnipeg's current rules.
The first new registration is the next future 08:00, not an immediate catch-up.
Existing missed triggers use Windows StartWhenAvailable. Only the current
Winnipeg day can run; old days are not backfilled. A delayed run records lateness
and never claims punctuality. An 08:00 claim additionally requires a correlated
Windows time-trigger event. Missing/disabled event history remains unknown.

The computer must be on and the approved Windows user signed in (Interactive,
Limited principal). Backend, Bridge, existing user/machine HUB_TOKEN hydration,
source authorization and network must be available. The fixed task folder and
runtime script installation require controlled verification. The adapter refuses
real OS execution from tests or any root other than the canonical runtime root.
No logon bypass, stored password, elevation, service ACL change, secret in task
arguments, power/wake policy change or unrelated-service change is introduced.
If Backend is down, Windows records a nonzero runner result; this cannot
manufacture a Backend receipt. There is no guaranteed delivery or automatic
same-day retry. Next-day execution or explicitly approved orphan recovery is the
bounded recovery path in V1.

## Severity and acceptance

P0/P1 correctness, authorization, false-completion, duplicate-execution,
uncertain-registration and goal-loss findings must be fixed before acceptance.
Regression tests exercise those boundaries with synthetic sources and fake OS
schedulers; local ephemeral HTTP servers only test the real routing.

First full-suite compatibility findings (text classification and the existing
chat file package ceiling) were repaired without changing any registered file
paths or tool operations. A measured P1 idle-reporting defect during approved
Windows registration was repaired by including management operations in the
existing workflow occupancy signal. The first independent review reported a P2
dialogue-lock leak on failed canonical reads and a P3 fractional-hour admission
gap. Both were repaired because recovery/status availability and faithful fixed
time selection are explicit acceptance criteria. Regression tests cover each.
An existing OAuth-path unit test also read the Owner's mutable credential file,
making offline results depend on live login state. It now checks the same child
environment and credential-path behavior against a temporary synthetic profile;
no Owner credential is changed or claimed valid by that test. Actual Claude
subscription review authentication is measured separately by the review receipt.
The subsequent exact-commit review reported two P3 boundary gaps, also repaired
for explicit acceptance criteria: alternate hour/meridiem/foreign-zone requests
are refused rather than mapped to 08:00, and lock identities are fully written
and flushed before exclusive atomic publication. A killed initializer cannot
publish an empty lock. This uses local filesystem hard links within the same
store directory; unsupported filesystems fail closed rather than falling back
to a non-atomic lock. Existing malformed legacy locks still require inspection;
V1 does not delete a lock whose live holder cannot be established safely.
The next review also found a pre-read admission window missing from occupancy;
the run is now marked occupied immediately after its execution lock is acquired,
including during Windows inspection and error handling. Spaced hours, alternate
cadences and explicit compact-hour forms have dedicated refusal regressions.
This remains bounded intent admission for one fixed workflow, not a general
temporal-language interpreter. The original objective and all its constraints
remain intact, and approval always displays the fixed Winnipeg 08:00 scope.
The following review found a P2 cancellation defect after deletion of the
creating conversation. Owner-only reduction proposals now use the saved
schedule's own task/goal scope from any conversation, display those references
and require fresh approval. Create/resume keep the original conversation check.
Tests revoke after actual conversation deletion, forbid foreign resume or goal
scope changes, and preserve an unrelated goal in the reducing conversation.

Deferred P2: source contract lacks freshness evidence and cannot retrieve more
than its server cap. This blocks claiming a COMPLETE live list, not reporting
an honest PARTIAL list. Broader supplier/inventory semantics need a separately
approved source-contract change. Deferred P3: general natural-language schedule
editing, custom hours/workflows, multiple schedule instances, email/push,
same-day retry/backfill, timezone portability and Costco execution.

## Controlled deployment and acceptance plan (not executed)

1. Verify the exact tested/reviewed commit and tree, fresh main/runtime/Bridge
   SHAs, CI/policy gates, idle status, environment and protected launcher hashes.
   Preserve a forward-history rollback point. Stop on unexplained divergence.
2. Obtain separate approval for promotion, local reload, feature activation,
   fixed-task registration and bounded live read acceptance. No business writes.
3. Merge through existing gates only; deploy the identical reviewed tree while
   preserving launcher, configuration and data. Verify Backend/Bridge SHA and
   health. Do not replay unrelated promotion helpers or change unrelated services.
4. Keep the feature off until host timezone, logged-in limited principal, fixed
   task folder, installed runner and existing token access are verified. Enable
   the exact read workflow through the approved configuration change only.
5. Submit the original request in Imagine. Verify all goal clauses survive,
   only the report is proposed, no Windows task exists before explicit approval,
   then approve the exact displayed proposal and verify Windows definition,
   task/goal link and grant. Inspect reload, status, pause and fresh resume.
6. Under separately approved read access, witness one fixed time trigger or an
   explicitly labelled manual/late invocation. Verify the source coverage,
   supplier mapping, unresolved rows, persisted report, actual timing, no false
   COMPLETE and no GOAL_COMPLETED for the original Costco-containing objective.
   Redelivery must not re-read. Revoke and prove the next read is refused.
7. For rollback: revoke/pause and verify disabled state before reverting code via
   forward history. Preserve task/conversation/report/approval evidence. Never
   leave an enabled new task pointing to code without its endpoint. Do not delete
   the last rollback ref, force-push, reset or touch the production business DB.
