# Reviewed local adoption of the first controlled repair

Owner instruction: apply the accepted isolated repair to the current local
Xiangxiang version and verify the running release. This is a developer delivery;
it does not grant the repair worker an automatic application capability.

Accepted isolated work order: `b68021d2-6131-43fc-981b-5336424748f6`.
Accepted patch SHA-256:
`1a27e52e9b03374c6ada576b0ef24af1a63da87d274240e33345ade4e6d0a44b`.
Original diagnosis snapshot: `2b5b2ea0dd16582e1768c8ad0cb6bb681abcdb58`.
Adoption parent: `445d9661db2ac2769505a0360c14a92eced8df61`.

Before editing, current committed sources were compared with the accepted
before/after content and hashes. Development planner, dispatcher and agent-health
changes match the accepted recipe exactly. The run store reconciliation preserves
the newer `code_repair` workflow and adds its independent default directory.
An independent copy of the current parent reproduces six failures out of seven
checks; the reconciled copy passes all seven without skips.

The development planner acknowledges cancellation/timeout promptly, saves one
terminal result and memory receipt, discards late provider output and holds its
busy slot until an uncooperative provider settles. It also bounds subscription
preflight and both context reads. A provider that never settles intentionally
keeps that instance busy; this release does not pretend cancellation stopped it.

Default directories are `manager-runs`, `development-plan-runs`,
`code-diagnosis-runs` and `code-repair-runs`. Existing explicitly configured
directories retain their behavior. Live composition already used separate
directories; no historical data is moved or purged. Corrupt records still fail
closed within their own workflow. Unsupported workflow names are rejected.

The dispatcher uses measured finite costs consistently across return values,
events, timeline and health. Missing/nonfinite or thrown-attempt costs are null.
Known zero and numeric costs remain unchanged. Health tracks cost observations
separately from total attempts; unknown observations do not dilute averages or
rank as free. The generic adapter normalization API remains unchanged.

Persistent regression tests cover late resolution/rejection, timeout, busy-slot
retention, cancellation in preflight/read/reverification, durable directory
separation including code repair, corrupt history, known/unknown costs and ranking.
The full backend suite must pass before delivery. Live acceptance additionally
checks committed source hashes, exact `/health` boot commit, Owner-gated views,
retained original work order/history and compact adoption receipt. Controlled
in-process probes exercise the modules loaded from the deployed release without
calling providers or modifying operational job stores.

The original isolated work order remains historical with `appliedToLive:false`.
The separate adoption proof records this release's reconciliation and running
acceptance; original approval/hash evidence is never rewritten. Architecture
lists this reviewed local adoption and still marks arbitrary edits, network-
isolated model-code execution, Claude repair, other projects and automatic live
application unconnected. Memory acceptance automation remains Owner-paused.
No production restaurant writes, email sends, paid API fallback, credit purchases,
account-control changes or remote Git pushes occur in this delivery.
