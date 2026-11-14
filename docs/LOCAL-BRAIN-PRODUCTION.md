# Formal local brain composition

This release is prepared in an isolated worktree. Source installation, production
deployment and real dialogue acceptance are separate gates. No historical usage
ledger is resumed, rewritten or used to authorize the work in this document.

## Reviewed activation

`src/index.js` validates process role, persona, service authentication and loopback
bind before activating `localBrain/production.js` and importing the formal app.
The committed deployment profile selects Qwen3.5 9B, the recorded digest, context
65,536 and the existing loopback Ollama endpoint. It does not install or download
Ollama, create a new Windows service, change the private launcher overlay, rewrite
the old cloud settings, issue credentials or silently fall back to another model.
The existing XIANGXIANG_MEMORY switch still governs memory initialization. With
memory disabled, startup and health remain write-free; activation does not turn
that switch on or open an index database merely to report service health.
Every inference verifies installed alias/digest metadata before sending its chat
request. Ollama remains resident through the existing adapter's keep_alive=-1.

The same formal app, Owner/session boundary, conversations, Memory Gateway,
authorized read tools, exact computations, Policy and evidence guards are reused.
The formal Model Center has a separate local settings file; old cloud settings
remain intact for an explicitly authorized recovery. The ordinary demo page reads
the local catalogue, displays local selection and receives SSE phase progress and
one final guarded response. Provisional model text is not presented as a verified
answer. Timing receipts contain phase metadata, not a second copy of prompts.

Snapshot/fixture launch variables are refused by the formal entry. The isolated
launcher is not a production installer. Its inventory fixtures, owner password,
source snapshot, SQLite canonical copy and test preference candidates must never
be installed into production.

## Canonical memory and background work

Formal memory continues using the existing canonical PostgreSQL structured-store
transport and its revision checks, source attribution, scopes, approvals and audit.
The formal LocalService account reuses the existing authenticated Bridge storage
RPC at exactly `127.0.0.1:8091/memory-store`. This endpoint invokes the existing
canonical Python store, not a model client; all Bridge inference/worker endpoints
remain blocked. LocalService need not read the private PostgreSQL instance file
in the Owner profile. No canonical schema migration, new database role, credential
or ACL change is required. Missing storage authorization fails closed.

`data/memory-local-index/memory.sqlite` holds only derived documents and durable
inference reservations. It never seeds or replaces the canonical store. The
existing outbox and consolidation settings/queues are reused. The legacy capture
worker is not started or wrapped around new conversations in local mode, so a
turn is not queued twice. Existing source receipts are historical and are not
claimed as proof of re-extraction by the local engine. Canonical source retrieval
remains available when the local quote index is empty. This is lexical retrieval,
not a claim of semantic equivalence to the old vector index.

The existing local learning engine rejects cloud adapters, validates verbatim
quotes, preserves source/scope checks and proposes approval-required candidates.
Running or failed inference reservations survive restart and do not automatically
resend. The existing backup mechanism captures a consistent SQLite backup through
SQLite's backup API, including committed WAL state, and restores files only into
a new isolated destination. Lock files are not replay authority.

Email analysis/indexing and subscribed code/delegation workers are not migrated.
Their local-mode startup/work paths are disabled or refused, with an explicit
unavailable result. No local model is substituted for a worker's execution rights.
The old subscribed Bridge and Hindsight processes may serve separately authorized
work. This formal local process can use the Bridge storage RPC but cannot submit
inference to either process.

## Transport boundary

The process-local fence is installed before importing the formal app. All HTTP,
fetch and socket traffic needs an approved destination context. Allowed routes are
the pinned loopback Ollama/tokenizer APIs, the existing authenticated memory-store
RPC, and a narrow existing GET-only business
read set: Aroma inventory/supplier/count/planning/order/invoice endpoints, Google
Drive/Gmail/Calendar/Sheets reads, plus Google's existing OAuth token endpoint.
Original source credentials, scopes, same-origin and Gateway authorization remain
required. Other websites, GitHub, Seven Shifts, browser operators and unlisted
business services are currently unavailable from this local composition. Adding
another destination requires reviewed integration, not a model-provided hostname.

Redirects and transport overrides cannot move an allowed request to an AI host.
Raw sockets, Bridge inference/Hindsight traffic and arbitrary child processes
are refused. The only child allowance is the exact existing native canonical
store/backup Python program and argument shapes; reviewed Python source hashes
must remain unchanged. This is not an OS sandbox and does not claim to constrain
other user applications or a malicious administrator.

No network configuration, Windows ACL, service account, API allowance or P02-C
policy is changed. External data reads still require network access; local AI
inference does not mean the complete assistant is offline.

## Verification and recovery

Integration fixtures must exercise the actual formal app/session/Model Center/SSE
and canonical-store contract, including rejection before cloud sends, opt-out,
source preservation, durable learning and consistent derived backup. Fixture or
transport-stub results are labelled as such and do not replace post-deployment
dialogue/model or live inventory acceptance. Existing real isolated local model
evidence is carried only for unchanged functionality, with its original SHA.

Before any promotion: exact candidate/tree, full tests and subscription independent
review, PR/CI, fresh existing backup/isolated restore proof, source baselines,
Ollama digest and loopback health, existing account access and nine paused-ledger
hashes must be checked. No model inference is required for these technical gates.
New acceptance allowance, if wanted, is a separate explicit decision; no existing
paused root is consumed or reset.

The normal exact-version Owner entry remains authoritative. Scope exception,
Hold release and deployment consent are separate sealed decisions, bounded to
the reviewed material and ten minutes. Never automate the personal response.
Do not run repo:finish to override an explicit preparation-only instruction.

If a local release cannot start or verify, record the real failure and preserve
data and counters. Automatic rollback from a local profile to a cloud baseline
is refused before creating rollback refs or reloading: restoring the old code
could restart cloud background inference. The workflow records the explicit
recovery blocker and requires a fresh concrete Owner recovery decision. Local
to local exact-source forward-history recovery still uses the existing gates.
No production canonical restore, hard reset, broad kill, spent-run replay,
credential change or automatic cloud fallback is part of this release.
