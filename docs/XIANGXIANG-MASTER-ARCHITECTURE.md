# Xiangxiang operating layer

Owner direction adopted on 2026-09-29. First acceptance workflow: operations
briefing from existing read-only data and work queues.

## Ownership and boundaries

Xiangxiang is the manager layer. A model is a replaceable computation provider;
an agent is a role and capability contract; a tool is a bounded operation. These
are distinct from the executive's identity and from business records.

Aroma System remains the source for restaurant facts. Its existing GET-only API
adapter is reused; this change neither edits that repository nor migrates its
database. Local Xiangxiang task/proposal state is authoritative only for
Xiangxiang workflow state, never for inventory, prices or approved invoices.

| Information | Authority | First workflow |
| --- | --- | --- |
| Business truth | Aroma System through the existing read connector | Replenishment suggestions and invoice records |
| Calendar truth | Calendar records within the requested window | Next 24 hours, explicitly labelled |
| Workflow truth | Existing Xiangxiang task/proposal stores | Todo tasks and pending proposals |
| Knowledge | Documents with source references | Recently modified Drive documents |
| Memory | Historical context only, not current facts or permission | Existing recorded decisions through a replaceable recall adapter |

Retrieval time is not data-as-of time. Counts mean records returned by the
bounded query, not total records in the source or events occurring today.
Missing timestamps, totals and failed reads remain unknown.

## Implemented path

```text
Authenticated Owner -> /manager -> POST /api/v1/manager/briefing
  -> fixed daily_briefing plan
  -> role/tool permission check
  -> Tool Gateway -> existing read connector -> bounded GET/read adapters
  -> Memory Gateway -> local decision recall (advisory)
  -> local task/proposal readers
  -> source-labelled cards + immutable activity events
```

`src/core/operating/registry.js` defines separate role and tool contracts. The
briefing roles use a deterministic engine with `model: null`; these are bounded
workflow steps, not newly deployed autonomous AI employees. Existing specialist
workers and their dispatcher remain responsible for their existing work.

`gateway.js` adapts the established read layer rather than opening a second
network client. It preserves unavailable/empty distinctions and coverage limits.
The memory adapter implements `recall()` independently of the workflow. No truth
read can be satisfied by a memory result.

`manager.js` owns the closed plan, concurrent-run refusal, ten-second refresh
spacing, start/end events and per-tool outcomes. Each step is audited before the
next step starts. If persistence fails, the workflow stops and reports failure.
Partial reads produce a partial briefing, with each unavailable source visible.

`activityStore.js` uses exclusive-create event files in the existing data root's
`manager-activity` directory. It stores actor, time, reason, workflow/run ID,
role, model, tool, source, layer, approval status, outcome and measured count.
It does not persist email/document bodies or retrieved business rows. The UI
shows the latest 100 events; this is a view limit, not deletion or retention.

## Permission and approval

The existing owner gate protects the page and all three API endpoints. The POST
also requires a matching local Origin and an empty JSON object. HTTP callers
cannot supply an actor, model, tool, arbitrary parameters, URL, plan or authority.

This workflow only reads. It has no send, purchase, change-price, approve-invoice,
deployment or deletion tool. Pending proposals remain in the existing approval
workflow. Showing a pending proposal does not approve it. Manager and Staff
roles are not yet authenticated roles of this application and are refused by
the new permission check.

## Product surface

The existing Xiangxiang sidebar links to **Operations briefing**. Refresh is an
explicit user action; opening the page reads only activity and registry metadata.
Cards show source, layer, check time, returned/shown counts, bounded rows and
coverage notes. A missing source never renders as an empty task queue.

The activity view and expanded architecture details expose what ran and which
integrations are not connected. The current version uses no model calls.

## Remaining architecture stages

This is the first Core workflow, not completion of the entire master diagram.

- Hindsight PoC: isolated development namespace, adapter contract tests, explicit
  endpoint/auth configuration and reviewed retention before real ingestion.
- Additional memory storage engines: implement the gateway contract and a reviewed
  migration; do not replace business PostgreSQL with memory.
- Domain workers: add Email/QA/Coding/Purchasing/Accounting/Review workflows one at
  a time, with execution evidence and model/provider bindings independent of roles.
- QBO, 7shifts, supplier communications and write tools: not connected by this
  change. Each needs a specific workflow, credentials/scopes and approval contract.
- Notifications and autonomous scheduling: require an explicit cadence and delivery
  destination. No background communication or autonomous purchasing is activated.
- Model-authored summaries: validate grounding and budget behavior before enabling;
  the current deterministic briefing is the acceptance baseline.

## Validation and rollback

Tests cover owner permissions, forged plans, Origin checks, actual app mounting,
truth/memory separation, source errors versus measured zero, unsafe source links,
queue-state filters, historical provenance, audit persistence and concurrency.
The ordinary full repository suite remains required with known baseline failures
reported separately. Live validation must name the boot commit and observed page.

Rollback by reverting the operating-layer commit and restarting the backend.
Keep `manager-activity` for audit history. Source systems need no rollback because
the new workflow performs no source mutation. No new package is installed.
