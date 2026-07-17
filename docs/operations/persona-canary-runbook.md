# Persona Canary Operations Runbook

> **Scope:** the isolated persona canary implemented in R4a–R4c. This is a
> **documentation-only** artifact. Following it must not modify runtime code,
> production configuration, Memory truth, Guardian, backup/restore state, the reverse
> proxy, the service manager, or committed environment files. All values below are
> verified against the current source (`src/personaCanary.js`,
> `src/persona/processRole.js`, `src/persona/personaCanaryHealth.js`).

---

## 1. Purpose and safety boundary

The **persona canary** is a **localhost-only, isolated validation process** used to
exercise the persona-source selector (`shadow` / `hybrid`) and its readiness gates
**without touching the primary process or production traffic**.

- The canary binds **only** to `127.0.0.1` — it must **never** receive public traffic.
- The canary must **never** replace or modify the primary process during R4 testing.
- The **primary** always runs `AROMA_PROCESS_ROLE=primary` (or unset) and
  `PERSONA_SOURCE=legacy` (or unset). The canary process never changes the primary's
  environment; each process reads its own env.
- The canary is a **short-lived, operator-started** process. No long-running canary is
  left behind.

---

## 2. Architecture and entrypoint

| Property | Value (from source) |
|---|---|
| Entrypoint | `node src/personaCanary.js` |
| Bind host | `127.0.0.1` (hardcoded, non-negotiable) |
| Default port | `8082` (override for local testing only: `AROMA_CANARY_PORT`) |
| Process role | `persona-canary` (the entrypoint declares it; rejects an explicit non-canary role) |
| Canary-only default source mode | `shadow` (set **inside the entrypoint only** when `PERSONA_SOURCE` is unset) |
| Separate service token | `AROMA_CANARY_TOKEN` (required) |
| Primary listen port (for contrast) | `8081` (`PORT`, default) |
| Log tags | `[AROMA-CANARY]` (canary), `[AROMA-PERSONA-SOURCE]` (persona telemetry, stderr) |

**The primary `HUB_TOKEN` must not be reused for the canary.** The canary builds its
app with its own injected token (`AROMA_CANARY_TOKEN`); the primary's `HUB_TOKEN` is
never read by the canary entrypoint.

---

## 3. Preconditions

Before starting a canary run, confirm all of the following (read-only checks):

1. **Clean working tree** — `git status --porcelain` is empty.
2. **Expected branch and commit** — verify the branch and the exact commit you intend
   to run (e.g. `git rev-parse --abbrev-ref HEAD` and `git rev-parse HEAD`).
3. **Production frozen-state read-back** — Identity `active`, Operating Principles
   `review_ready`, Personality `ABSENT` (read-only; see §12 for the exact command).
4. **Port `8082` is free** — nothing is already listening.
5. **No existing canary process** — no prior `node src/personaCanary.js` is running.
6. **Seagate / backup requirements** — a canary in `shadow` mode needs **no** backup.
   The canary never writes production truth. Any operation that would require the OP /
   Personality **production lifecycle** (approve / activate) is **out of scope for the
   canary** and is gated by the separate A1 backup sequence — do not perform it here.
7. **No production lifecycle write** is part of this run (the canary performs none).

If any precondition fails, **STOP** and do not start the canary.

---

## 4. Safe environment setup

Set the canary token as a **temporary, process-local** environment variable. **Never**
place secrets into a committed file, and **never** echo or print the token value.

**PowerShell (AromaBrain default shell):**

```powershell
# Process-local only — not persisted, not committed. Choose a strong random value.
$env:AROMA_CANARY_TOKEN = (Read-Host -AsSecureString | ConvertFrom-SecureString)  # or paste a secret without echoing
# Optional isolated data root so the canary never shares the primary's .aroma/data:
$env:AROMA_DATA_DIR = "$env:TEMP\aroma-canary-data"
# Optional local port override (default is 8082):
# $env:AROMA_CANARY_PORT = "8082"
```

**Bash (Git Bash):**

```bash
read -rs AROMA_CANARY_TOKEN   # typed without echo
export AROMA_CANARY_TOKEN
export AROMA_DATA_DIR="$TEMP/aroma-canary-data"   # optional isolated data root
```

Notes:
- Do **not** set `AROMA_PROCESS_ROLE` — the entrypoint declares `persona-canary` itself.
- Do **not** set `PERSONA_SOURCE` for a shadow run — the entrypoint defaults it to
  `shadow`.
- **Shadow startup** (first canary): leave `PERSONA_SOURCE` unset → `shadow`.
- **Hybrid startup** (later readiness-validation example, **expected NOT READY** under
  the current frozen production state): set `PERSONA_SOURCE=hybrid`. The process still
  starts and binds, but `/persona-canary/readiness` returns `HYBRID_NOT_READY /
  ready:false` because Operating Principles is `review_ready` and Personality is
  `ABSENT`. This is expected — do not treat it as a failure, and do not attempt to
  activate anything to "fix" it.

---

## 5. Startup procedure

Start the canary explicitly and capture the PID safely.

**PowerShell:**

```powershell
$canary = Start-Process node -ArgumentList "src/personaCanary.js" -PassThru -NoNewWindow
$canary.Id   # the PID — record it
```

**Bash:**

```bash
node src/personaCanary.js &
CANARY_PID=$!
echo "canary PID: $CANARY_PID"
```

Expected startup log line (stdout):

```
[AROMA-CANARY] persona-canary listening on 127.0.0.1:8082 | process role: persona-canary | persona source: shadow
```

**Verify the bind is localhost-only** (must show `127.0.0.1:8082`, never `0.0.0.0`, a
public interface, or the primary port `8081`):

```powershell
Get-NetTCPConnection -LocalPort 8082 | Select-Object LocalAddress, LocalPort, State
```

```bash
netstat -ano | grep ":8082"
```

Do **not** configure Nginx, DNS, a firewall rule, systemd, PM2, launchd, Docker port
publishing, or any public proxy for this port. The localhost bind is the entire access
boundary.

---

## 6. Health and readiness verification

Two canary-only GET endpoints (mounted only on the canary process):

- `GET http://127.0.0.1:8082/persona-canary/health`
- `GET http://127.0.0.1:8082/persona-canary/readiness`

**Safe response fields (the complete allowlist):**
`endpoint`, `processRole`, `personaSourceMode`, `status`, `ready`, `reason`,
`hybridComposerReady` (readiness only). Nothing else is ever returned.

**Health — expected:**

```json
{ "endpoint": "health", "processRole": "persona-canary", "personaSourceMode": "shadow", "status": "CANARY_ALIVE", "ready": true }
```

**Readiness — current expected result under the frozen production state**
(Identity `active`, OP `review_ready`, Personality `ABSENT`):

- **shadow:**

```json
{ "endpoint": "readiness", "processRole": "persona-canary", "personaSourceMode": "shadow",
  "status": "SHADOW_READY", "ready": true, "hybridComposerReady": false, "reason": "HYBRID_PERSONA_NOT_READY" }
```

- **hybrid:**

```json
{ "endpoint": "readiness", "processRole": "persona-canary", "personaSourceMode": "hybrid",
  "status": "HYBRID_NOT_READY", "ready": false, "reason": "HYBRID_PERSONA_NOT_READY" }
```

**Shadow readiness `ready:true` does NOT mean hybrid output is active.** In `shadow`
mode the model always receives the **legacy** persona; readiness is `true` because
legacy can always serve. `hybridComposerReady:false` reports that the hybrid persona is
not yet composable (OP not active / Personality absent) — the hybrid persona is never
sent to the model in shadow mode.

Query commands:

```powershell
Invoke-RestMethod http://127.0.0.1:8082/persona-canary/health
Invoke-RestMethod http://127.0.0.1:8082/persona-canary/readiness
```

```bash
curl -s http://127.0.0.1:8082/persona-canary/health
curl -s http://127.0.0.1:8082/persona-canary/readiness
```

---

## 7. Request-isolation checks

1. **Primary still serves normally** — the primary process on port `8081` continues to
   answer `GET /health` (200) and its normal routes, unaffected by the canary.
2. **Primary returns 404 for canary-only endpoints** — on the **primary** port:
   `GET http://127.0.0.1:8081/persona-canary/health` → **404** (and `/persona-canary/readiness` → 404).
   The canary endpoints exist only on the canary app.
3. **Canary uses only the separate token** — the canary authenticates state-changing
   routes with `AROMA_CANARY_TOKEN`, never the primary `HUB_TOKEN`. (The health/readiness
   GETs are open, like the generic `/health`.)
4. **No public route/proxy reaches `8082`** — confirm the reverse proxy forwards only to
   the primary; port `8082` is not published anywhere. If any external reachability is
   observed, treat it as a fail-closed condition (§10).

---

## 8. Observation procedure

**May be inspected / recorded:**
- process role (`persona-canary`),
- source mode (`shadow` / `hybrid` / `legacy`),
- health / readiness `status` and `ready`,
- safe telemetry / status codes (`[AROMA-CANARY]`, `[AROMA-PERSONA-SOURCE]` lines —
  which carry only revision IDs, mapping commit, and status codes).

**Must NOT be logged, copied, or shared:**
- token values or token fingerprints,
- persona text or fragments,
- request bodies containing private data,
- environment dumps,
- filesystem paths,
- stack traces,
- model / provider secrets or configuration.

The endpoints and telemetry are designed to emit only the safe allowlist; do not add
ad-hoc logging that captures any of the forbidden items.

---

## 9. Stop procedure

Always stop the canary when done (no long-running canary).

**Graceful stop first:**

```powershell
Stop-Process -Id <PID>        # graceful
```

```bash
kill "$CANARY_PID"            # graceful (SIGTERM)
```

**Escalation only if graceful stop fails:**

```powershell
Stop-Process -Id <PID> -Force
```

```bash
kill -9 "$CANARY_PID"        # SIGKILL, last resort
```

**Verify after stopping:**
1. PID is gone (`Get-Process -Id <PID>` errors / `ps` shows nothing).
2. Port `8082` is free (`Get-NetTCPConnection -LocalPort 8082` returns nothing).
3. No `node src/personaCanary.js` process remains.
4. Primary is unaffected (primary `/health` still 200 on `8081`).

Then unset the process-local env you set in §4 (close the shell, or
`Remove-Item Env:AROMA_CANARY_TOKEN` / `unset AROMA_CANARY_TOKEN`).

---

## 10. Fail-closed scenarios

The canary must fail closed (exit non-zero, no listener) in each case below. Expected
signal shown:

| Scenario | Expected outcome |
|---|---|
| Missing `AROMA_CANARY_TOKEN` | `[AROMA-CANARY] FATAL … (CANARY_TOKEN_MISSING)`, exit ≠ 0, no listen |
| Explicit non-canary role (`AROMA_PROCESS_ROLE=primary`) | `FATAL … (PROCESS_ROLE_CONFIG_ERROR)`, exit ≠ 0, no listen |
| Unknown persona source (e.g. `PERSONA_SOURCE=memory`) | `FATAL … (PERSONA_SOURCE_CONFIG_ERROR)`, exit ≠ 0, no listen |
| Port already in use | `FATAL: cannot bind 127.0.0.1:8082 (EADDRINUSE)`, exit ≠ 0, no listen |
| Health failure | investigate; do not expose publicly; stop the canary |
| Readiness internal error | endpoint returns `status:"READINESS_ERROR", ready:false` (generic, no detail) — canary keeps running but reports not-ready |
| Unexpected listener/interface (anything other than `127.0.0.1:8082`) | STOP immediately; treat as exposure |
| Any public exposure of `8082` | STOP immediately; remove exposure (see §11) |
| Any production truth change observed | STOP; this is out of scope for the canary — a canary never writes truth |
| Any model invocation or lifecycle write during startup/readiness | STOP; neither is permitted (startup and readiness perform neither) |

---

## 11. Emergency stop and rollback

Canary rollback is simply **stopping the canary process** — the primary is always
legacy and is never touched.

1. Stop the canary process (§9; force-kill if needed).
2. Remove only the **temporary, process-local** environment state you set (`AROMA_CANARY_TOKEN`,
   `AROMA_DATA_DIR`, `AROMA_CANARY_PORT`). Do **not** edit production env as a rollback
   mechanism.
3. Do **not** change the primary mode (it is already `legacy`).
4. Do **not** modify Memory truth, deactivate a store, or delete a revision/event.
5. Confirm the primary remains `legacy` and healthy (primary `/health` 200 on `8081`).
6. Confirm port `8082` is free and no canary process remains.

---

## 12. Evidence checklist

Record the following for each canary run:

- [ ] **Baseline commit** — `git rev-parse HEAD`.
- [ ] **Exact command used** — e.g. `node src/personaCanary.js` with the env set in §4.
- [ ] **PID** — the recorded canary process id.
- [ ] **Bind-address proof** — `127.0.0.1:8082` only (netstat / `Get-NetTCPConnection`); not `0.0.0.0`, not a public interface, not `8081`.
- [ ] **Health response** — `CANARY_ALIVE / ready:true`.
- [ ] **Readiness response** — shadow `SHADOW_READY / ready:true / hybridComposerReady:false / HYBRID_PERSONA_NOT_READY`.
- [ ] **Primary 404 proof** — primary `/persona-canary/health` → 404.
- [ ] **Primary health proof** — primary `/health` → 200.
- [ ] **Before/after production frozen-state proof** — Identity `active`, OP `review_ready`, Personality `ABSENT`, identical before and after. Read-only check:

  ```bash
  AROMA_CORE_DIR="C:/Users/louis/AromaCore/core-data" node scripts/persona/verifyHybridPersona.js   # expect HYBRID_PERSONA_NOT_READY, exit 4
  ```

- [ ] **Zero-write proof** — production `AROMA_CORE_DIR` contents unchanged (only `identity` + `operating-principles` stores; no `personality` store) before and after.
- [ ] **No-model proof** — no LLM/adapter call occurs during startup or readiness (the readiness path takes no adapter; shadow always sends legacy).
- [ ] **Final port-free and no-process proof** — port `8082` free, no `personaCanary` process running.

---

## 13. Prohibited actions

While operating the canary you must **not**:

- Switch the **production** persona source to `shadow` or `hybrid`.
- Expose the canary publicly (no Nginx / proxy / DNS / firewall / port publishing).
- Change any reverse proxy, DNS, firewall, or service manager (systemd / PM2 / launchd / Docker).
- Leave a long-running canary process.
- Perform any Identity / Operating Principles / Personality lifecycle write
  (submit / approve / activate / reject / supersede / deprecate).
- Invoke a model during startup or readiness.
- Perform any backup or restore action unless separately approved.
- Execute R4e (local isolated canary test) — that is a separate GO.
- Perform the R5 production cutover — that is a separate GO.

---

*This runbook documents R4a–R4c behavior only. Any production persona-source cutover,
OP/Personality production lifecycle change, or new milestone backup remains gated by
its own Owner GO and the A1 backup sequence.*
