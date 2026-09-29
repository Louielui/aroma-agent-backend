# Six-layer memory delivery contract

Owner request: implement the complete supplied architecture, 2026-09-29.
This checklist distinguishes implementation from live acceptance below.
The supplied July Drive quotation is a design input, not independently verified evidence.

## Required acceptance

- [x] Working: current goal/project/worker/run/context, expiry and terminal cleanup.
- [x] Episodic: attributed observations and measured outcomes, original source searchable.
- [x] Semantic: derived candidates with evidence; approval before authoritative use.
- [x] Decision: PostgreSQL canonical subject/decision/decider/time/evidence/status/provenance.
- [x] Procedural: canonical SOP links/version plus use/exception history; no copied SOP authority.
- [x] Preference: personal/company scope, explicit approval or narrow owner capture policy.
- [x] Gateway: one runtime entry for observe/retain/recall/decision/authorize/provenance.
- [x] Lifecycle: ignore/temporary/candidate/validate/approve/retain/recall/reflect/supersede/archive.
- [x] PostgreSQL: separate local database, transactions, audit, revision conflict checks.
- [x] Hindsight and pgvector: scoped semantic index; failures never erase canonical/source data.
- [x] Reflection and mental models: traceable derived proposals, refresh and stale detection.
- [x] Scopes: global/company/domain/agent/private; deny cross-scope access before retrieval.
- [x] Domains: development, purchasing, accounting, operations, email, management, HR.
- [x] Source adapters: observations can enter through authenticated gateway, no automatic
      promotion of external statements into company knowledge.
- [x] Chat: persist incoming message before generation; failed replies remain observable.
- [x] Existing records: idempotent import, preserve original attribution and unknown dates.
- [x] Retrieval: current decisions first, semantic plus source search, superseded exclusion.
- [x] Durability: pending outbox, bounded indexing, backup/restore verification.
- [x] Owner UI: six layers, candidates/approval/rejection, source/audit, scope, revisions,
      reflection/models, active work and connection/acceptance status.
- [ ] Delivery: meaningful red-first tests, full suite, local merge, restart, live bootCommit,
      visible architecture inventory and measured limitations.

## Policy

Complete historical recording is distinct from permanent company knowledge.
The owner has authorized private conversation/work history capture. That narrowly
defined policy can retain attributed private episodic history without a confirmation
per turn. A supplier claim, assistant suggestion or reflection is never an approved
decision. Shared semantic/procedural/preference/decision records need explicit owner
approval, tied to their exact revision. Approval of memory is not execution approval.
Ignore/opt-out and credential exclusions remain effective.

Business truth stays in Aroma/QBO/POS/7shifts; SOP authority stays at the source.
Memory stores links, evidence and historical observations with completeness limits.
External connections lacking configuration remain unconnected; supporting a domain
or a scope does not establish a live connection to that business system.

## Implementation map

M0: governed.js, structuredStore.js and structured.py implement gateway and canonical
PostgreSQL; hindsight.js is the index adapter. The database is
xiangxiang_memory_core, separate from Hindsight's existing database and the restaurant.
No backend dependency was added; the isolated Hindsight Python runtime supplies asyncpg.

M1: all six record types are managed at /memory. Candidate approval is tied to an
exact revision. Atomic supersession archives the former decision's authority before
activating its replacement. The audit contains hashed prior links and source snapshots.
Source confidence is null unless explicitly supplied; timestamps are never invented.

M2: reflection uses Hindsight with strict document tags from selected approved evidence.
Summaries are semantic candidates, persisted as mental models in canonical storage.
Refresh creates a new candidate; approval replaces the older model only after evidence
revision validation. This is gateway-managed mental models, not automatic Hindsight
consolidation. Consolidation remains disabled. Five scope classes use explicit grants
without implicit inheritance. Agent tokens are hashed, rotatable and revocable.

M3: every listed domain has a scope. Connected read adapters enqueue private external
claims as candidates; email content is not automatically approved. Scoped agents call
POST /api/v1/agent-memory with their own bearer token. They can observe/recall/get a
decision/manage working context/log SOP usage; they cannot approve or grant access.
The existing worker recipe journals measured stages. This does not claim that unconfigured
agents, QBO, POS or 7shifts have been connected or that their histories were imported.

## Operations

Owner API: GET /api/v1/memory/catalog, GET /api/v1/memory/catalog/:id (with audit),
POST /api/v1/memory/catalog. Operations: propose, observe, transition (approve/reject/
archive), index, reflect, working, finish, grant, recall, decision, procedure, backup.
Owner writes require exact local Origin and existing owner authentication.
Agent identity and scopes are resolved from a token, never from a caller's actor field.

Setup: scripts/memory/setupStructured.py, invoked with the existing local Python.
History import: scripts/memory/importHistory.js. Unknown legacy approvals become
candidates; original files remain untouched. Blank messages are not memory content.

Backup: scripts/memory/backupStructured.py backup <absolute-new-path>.
Verify/restore: the same script verify-restore <snapshot>. This creates a separate
restore database, compares every record/audit/grant and never overwrites the live DB.
The owner UI runs backup-and-verify with a generated local filename.
Backups contain canonical records and audit; existing chat archives, pending filesystem
outbox files and the rebuildable Hindsight index are separate data and are not included.
For machine recovery preserve those directories and private runtime configuration too.
Archive excludes recall and keeps the historical audit; it is not a privacy-erasure command.

## Measured acceptance before service cutover

- 126 conversation files inspected: 380 nonempty messages imported; two empty messages
  excluded. Six legacy decisions remain candidates, plus two capture documents: 388 rows.
- Consistent PostgreSQL backup f316b0d81c5d110bbb22afc4a7acfad87f1b7d4891aad25f98bfddf1dab14379
  restored to xiangxiang_restore_f316b0d81c5d; all four tables matched.
- SQL acceptance in that isolated restore proved round-trip, stale-write rejection,
  active-decision uniqueness and atomic supersession/audit, rolled back afterward.
- Full suite: 6,052 tests; 6,035 passed, 16 skipped, one pre-existing missing x44 fixture
  failure. Later adapter/label adjustments have focused regression coverage.
- Live browser, new-commit restart and real reflection acceptance are recorded in the
  delivery report; implementation checks above do not replace that evidence.

## Limits retained explicitly

Credential exclusion is heuristic. Policy capture covers private attributed history, not
infallible facts. Generation/indexing uses subscription quota; failures preserve canonical
text and permit source search. Unknown source dates stay null. Retrieval is bounded, so
neither all-history recording nor a connected index guarantees perfect recall in every answer.
Only declared sources and workflows are observed; activities in unrelated apps are not.
Large-volume performance and each external agent's live integration require separate evidence.
