# Local Hindsight memory pilot

Historical pilot record, 2026-09-29. The descriptions below document the initial
manual-only pilot and its measured acceptance; they are not the current capture,
coverage, backup, or supervisor contract. Automatic private history capture,
reviewable consolidation, scoped and source-bound mail indexes, historical mail
import, and operational recovery have since been implemented. Current contracts:
[MEMORY-SIX-LAYERS.md](MEMORY-SIX-LAYERS.md),
[MEMORY-CONSOLIDATION.md](MEMORY-CONSOLIDATION.md),
[MEMORY-RUNTIME-RELIABILITY.md](MEMORY-RUNTIME-RELIABILITY.md), and
[MEMORY-RECOVERY.md](MEMORY-RECOVERY.md). A configured adapter or an earlier
acceptance does not establish the current running service's health.

Hindsight 0.10.2 is installed in the separate `C:\Aroma\hindsight-runtime` Python environment.
The backend has no new package dependency. The existing Memory Gateway exposes the Hindsight
adapter alongside its local-decision adapter. The owner page `/memory` supports explicit
retention, correction using a stable document ID, and deletion. It is behind the existing
owner gate; mutations require same-origin JSON and accept neither bank selection nor roles.

## Data and model boundaries

Only owner-entered text is retained. There is no automatic import of old conversations,
emails, Drive documents or business records. The bank is server-configured as
`xiangxiang-owner`; acceptance uses `xiangxiang-test-acceptance`. Documents use `xx-<UUID>`.
Inputs are bounded and pass the existing red-line policy. API errors are not echoed.

The authenticated API binds only to `127.0.0.1:8888`. Its pg0 PostgreSQL instance is separately
named `xiangxiang-memory`, with a generated password and pgvector. It does not use the
restaurant database. Local multilingual embeddings and reranking require no provider API.
Hindsight extraction calls an OpenAI-compatible text-only route on the existing authenticated
subscription bridge (`8091/v1/chat/completions`). The existing restricted Codex completion
client supplies GPT-6 Astra through ChatGPT subscription authentication. No OAuth token is
copied into Hindsight and no OpenAI Platform API key is supplied. This uses subscription quota.
Automatic consolidation/reflection and temporal LLM retrieval are disabled for this pilot.

Chat recall runs only in the GPT chat answer-prompt stage, after routing, with memory enabled,
READ_ACCESS on and decision-context sharing enabled for OpenAI. It is not a routing source,
an approval or current business evidence. Recall is limited to five sourced facts / 800 tokens
and a six-second budget. Failure is represented as unavailable, never an empty memory bank.
Standalone greetings and website discovery keep their existing short paths.

Memory-derived assistant replies are marked as context-derived so the existing archive policy
does not copy them into subsequent conversation recall. This does not erase older transcripts,
current-thread context, backups or memory that the owner independently typed elsewhere.

## Verification and operation

Retention is synchronous and success requires a matching document readback with extracted
facts. Correction replaces the same document. Forgetting requires successful deletion followed
by a 404 readback. An ambiguous timeout is reported as unconfirmed; reload before retrying.
The management page lists up to 50 documents and explicitly labels truncation.

2026-09-29 isolated live acceptance: Chinese preference retained and recalled in 13.6 seconds;
correction recalled only the new colour; deletion then returned zero matching facts. Unit and
HTTP tests also cover bank isolation, malformed responses, disabled state, unsafe content,
authentication, same-origin mutations, tool/role restrictions and archive omission flags.

`scripts/memory/startHindsight.cjs` reads backend configuration and a local, untracked
`C:\Aroma\hindsight-runtime\local-config.json`. The `--acceptance` option points model work at
the temporary 8094 test bridge and reads `C:\Aroma\hindsight-runtime\acceptance.env`;
normal operation uses 8091 and the backend `.env`. The user-login supervisor starts
the local pilot with a maximum of three attempts. PostgreSQL data lives under
`C:\Users\louis\.pg0\instances\xiangxiang-memory\data` and survives restarts.
Backup/restore acceptance, larger datasets, automatic capture and reflection remain pending.

Roll back by setting `XIANGXIANG_MEMORY=off` and restarting backend and subscription bridge.
Stop only the verified Hindsight supervisor and child if retiring the runtime. Keep data for
recovery; do not remove the pg0 instance or runtime as part of a routine rollback.

Official references: https://hindsight.vectorize.io/developer/installation
https://hindsight.vectorize.io/developer/api/documents
https://hindsight.vectorize.io/developer/api/recall
