# Xiangxiang operating layer

Owner direction adopted on 2026-09-29. First acceptance workflow: operations
briefing from existing read-only data and work queues.

## Revised master baseline

The Owner supplied a consolidated Master Architecture on 2026-09-29. This section
supersedes the earlier memory-first implementation order. Preserve implemented
work, verify its actual integration, and complete foundations before enabling writes.
References to July design briefs in the supplied baseline are historical context;
this review establishes implementation claims from this checkout, not from those
unretrieved briefs.

Aroma owns Core, Data, Memory, Workflow, Permissions and Audit. OpenAI, Codex,
Claude and Hindsight are replaceable capability providers. Connections belong to
Xiangxiang and pass through shared gateways, rather than being independently
reconnected for each agent. A model provider is not Xiangxiang's identity.

Core responsibilities: Conversation/Capture, Context Engine, Planner, Capability
Router, Dispatcher, Tool Gateway, Memory Gateway, Policy Engine, Permission Engine,
Approval Gateway, Run Timeline, Audit Log, and Briefing/Notification. Existing
modules are reused; this inventory does not claim their end-to-end integration is
complete. The component actually executing a step must record its timeline state;
LLM completion text is not execution evidence.

### Core twelve

| ID | Component | Implementation / acceptance boundary |
| --- | --- | --- |
| 01 | GitHub | Existing read adapter; actual PR/branch/test coverage still needs acceptance |
| 02 | Google Drive | Existing read connector; recent-file listing verified, broader retrieval still scoped |
| 03 | Aroma System API | Bounded GET adapter; replenishment/invoice briefing reads verified |
| 04 | Calendar | Existing read connector; next-24-hour briefing query verified |
| 05 | Gmail | Foundation connected: account, read-only grant and one message-list sample verified through Connections; sending and label changes not connected |
| 06 | OpenAI / API | API adapter exists; verified subscription chat retained; paid use is workflow-specific |
| 07 | Codex | Subscription chat verified; unified technical execution dispatch still needs acceptance |
| 08 | Claude / API | Existing adapters/workers; architecture/review assignment and handoff need acceptance |
| 09 | Aroma Memory Gateway | Local decisions plus Hindsight adapter; bounded advisory recall after chat routing |
| 10 | Hindsight | Partially connected: explicit save, correction, recall and forget verified locally; automatic capture/reflection pending |
| 11 | PostgreSQL | Memory foundation connected: independent local pg0 instance; backup/restore acceptance pending |
| 12 | pgvector | Memory foundation connected: extension 0.8.5 and multilingual recall verified; larger datasets pending |

Read connector evidence: `src/context/liveClients.js`, `readConnector.js` and
`adapters/{github,drive,aromaSystem,calendar,gmail}Read.js`. Capability and worker
evidence: `src/capability/{registry,dispatcher,agents,adapter,policy}.js`,
`src/adapters/`, `src/agent/` and `src/subscription/`. Memory evidence:
`src/core/operating/gateway.js`. An adapter's existence is not a live health check.

### Target worker assignments, not active automatic routing

| Capability | Preferred | Alternative |
| --- | --- | --- |
| Coding | Codex | Claude |
| Browser | Codex | Manus, deferred |
| Computer Use | Codex | Manus, deferred |
| System QA | Codex / Claude | Grok, deferred |
| Architecture | Claude | OpenAI |
| General Reasoning | OpenAI / Claude | Evaluate when needed |
| Web Research | OpenAI | Grok, deferred |
| X Search | Grok, deferred | None |

Codex is the target technical execution worker. Claude is the target architecture
and review worker. These preferences do not activate a fallback, expand tool
permissions, or change subscription chat to paid API calls. Browser/computer
execution requires its own adapter, environment and acceptance evidence.

### Ordered roadmap

0. Aroma System foundation: preserve the business source of truth.
1. Core: Capture / Task / Decision / Approval and existing-module handoffs.
2. Eyes: GitHub, Drive, Aroma System, Calendar, Gmail in that order. Validate
   structural read-only interfaces, not merely configuration switches.
3. Workers: OpenAI/Codex and Claude; verify dispatch, costs and result evidence.
4. Memory: Memory Gateway -> Hindsight -> separate PostgreSQL/pgvector. PostgreSQL
   and pgvector are storage components, not parallel AI workers. Validate an
   isolated bank before real ingestion; test retain, cross-conversation recall,
   correction and forgetting. Reflection follows later.
5. Hands: Draft -> Recommend -> Approval -> Execute, one bounded operation at a time.
6. Business integrations: only with a concrete use case.
7. Agent automation: accept workflows by priority.
8. Progressive autonomy: define permissions separately from model capability.

Agent priorities: P0 Executive/Owner Assistant and Development; P1 Email,
Calendar and QA; P2 Purchasing and Accounting; P3 Review and HR.

Manus and Grok are deferred. Later business integrations include QBO, 7shifts,
Google Business Profile, POS, Cloudflare, Make, WhatsApp Business and SMS.
Purchasing portals (Costco, Wholesale Club, Amazon and other suppliers) follow
later. Supplier email reuses Gmail. Bank accounts, credit-card portals, CRA,
personal financial accounts and direct payment interfaces are excluded from this
scope; banking data, SIN, passwords and secrets are not worker task content.
This inventory implements no new connection, scheduling or execution policy.

## Ownership and boundaries

### Connections center (2026-09-29)

Owner-only `/connections` manages Gmail, Drive and Calendar through the existing
shared read connector. It exposes one metadata contract: source/read switch,
identity, granted scopes, last test, last success, sample count and bounded error.
Opening the page reads local metadata only. Credential presence is not connection
proof; an actual probe must pass, and evidence expires after 15 minutes or a
credential change. Disabling a source preserves other owner settings and blocks
subsequent reads; an in-flight read may finish. It does not revoke the shared
Google grant. The page links to Google's own access management for revocation.

Measured Google acceptance: Gmail one message-list sample, Drive one file metadata
sample, Calendar zero events in the next 24 hours. Identities and all three
read-only scopes were verified. Zero is a bounded sample result, not an account
total. No model, mail sending, file mutation or calendar mutation is used.
Status is under `connections/status.json`; audit events exclude identity and
Google content. This probe state does not replace the older configuration-only
context projection or add Gmail to the operations briefing.

Google reauthorization uses an owner-initiated flow, PKCE, one-use state and a
separate browser-binding cookie. Only a complete read-only grant atomically
replaces the refresh token. The three adapters share that credential. Real Google
re-consent is not yet accepted; existing credentials passed reads and were
preserved. A failed/cancelled flow keeps the previous token. The installed desktop
OAuth client uses the fixed loopback callback on port 8090. Connecting additional
services still requires a service-specific adapter and measured acceptance.

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
| Memory | Historical context only, not current facts or permission | Recorded decisions and explicitly saved owner preferences through the Memory Gateway |

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

The conversation sidebar now separates primary actions, a collapsible workspace,
conversation history and a fixed architecture/settings footer. Workspace entries
open the existing briefing, explicit memory page and development workbench. Title
search filters the conversations already loaded in the browser; it neither searches
transcript contents nor adds new provider access. Existing date/count metadata,
working indicators, deletion confirmation and server persistence remain in place.
Full-text search, pinning and project grouping are not implemented by this refresh.

The sidebar also opens `/architecture`, an owner-gated, server-rendered inventory
of eight layers: models, Core, tools, workflow, memory, business truth, knowledge
and approval. Each card distinguishes existing components, implemented scope and
the next integration step. It reuses the registry's unconnected-integration list.
Its review date is a release inventory date, not a health-check timestamp.
Opening the page makes no source, model or memory calls and grants no capability.

The consolidated inventory leads with the core twelve, target worker assignments,
Core responsibilities and Phase 0-8 roadmap. The eight-layer overview remains
expandable. Hindsight is now an opt-in local pilot through the existing memory
interface. The owner manages explicit memories at `/memory`; GPT chat retrieves
bounded advisory context after routing. Extraction uses the existing subscription
bridge, while multilingual embeddings and reranking run locally. See
`HINDSIGHT-MEMORY.md` for deployment, retention scope and measured acceptance.

The existing Xiangxiang sidebar links to **Operations briefing**. Refresh is an
explicit user action; opening the page reads only activity and registry metadata.
Cards show source, layer, check time, returned/shown counts, bounded rows and
coverage notes. A missing source never renders as an empty task queue.

The activity view and expanded architecture details expose what ran and which
integrations are not connected. The deterministic briefing uses no model calls;
explicit memory extraction and ordinary GPT conversation use subscription quota.

## Remaining architecture stages

This is the first Core workflow, not completion of the entire master diagram.

- Hindsight follow-up: backup/restore acceptance, larger datasets and separately
  scoped automatic capture/reflection. Explicit local retention, correction,
  retrieval and deletion have passed isolated acceptance.
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
the briefing performs no source mutation. The backend has no new dependency;
Hindsight has its own external Python runtime and PostgreSQL data directory.
