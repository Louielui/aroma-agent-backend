# Service v2 — install plan, ACL plan, and failure visibility

**Status: DOCUMENTATION ONLY. Nothing here has been executed.** No service was installed,
enabled, started or modified; no ACL was changed; no secret was provisioned; the Startup
shortcut was not touched. Each step below is marked `NOT EXECUTED — REQUIRES OWNER GO`.

## Why there is a v2 at all

The installed `AromaXiangXiangBackend` (WinSW 2.12, account `LocalService`, currently
`Stopped` + `Disabled`) points at:

- `C:\Aroma\releases\aroma-m1-backend\464c078…\src\index.js` — a pinned tree **611 commits**
  behind production, with no `.git`, so `/health` would have reported `bootCommit: null`
- working directory `C:\ProgramData\AromaXiangXiang\config`, so `dotenv` would read a
  **different `.env`** than production
- `AROMA_DATA_DIR` → a **second data store**, with none of production's conversations
- **four** environment values against the launcher's **twenty-one**, and no `PORT`, so it would
  bind **8081** beside a launcher holding 8090 — two assistants, no collision to notice

None of that is repaired here. v2 replaces it; the old artefact set stays on disk for
provenance and must never be started.

## What v2 changes, and what it deliberately does not

**Changes:** who owns port 8090. **Does not change:** the code, the repo, the `.git` identity,
the data directory, the `.env`, or any runtime flag. `runtimeContract.js` is transcribed from
the running launcher and `runtimeContract.test.js` fails if the two ever disagree.

## Install sequence — NOT EXECUTED, REQUIRES OWNER GO

⛔ **There is no spare-port live validation, and there must not be one.** An earlier draft of
this plan said to "override `PORT` in `service.env` for spare-port validation". That was not
merely undocumented — it was **impossible**: the entry loads `service.env` and *then* applies
`STABLE_ENV`, which sets `PORT=8090`, and the allowlist now refuses a `PORT` key outright. The
fix is not to weaken the stable contract so the documentation becomes true. A runtime override
seam would reintroduce exactly the drift this whole tranche exists to prevent, for the sake of
a rehearsal. So the rehearsal is **non-binding** instead, and the only live bind is the real one.

1. **Provision.** Create `C:\ProgramData\AromaXiangXiang\config\service.env` from
   `service.env.template`. Exactly three keys — `ANTHROPIC_API_KEY`, `HUB_TOKEN`,
   `CLAUDE_CHAT_MODEL` — filled there, never in git. Apply the ACL plan below.

2. **Non-binding LocalService preflight.** Runs as `LocalService`, starts no server, binds no
   port, and proves:
   - the production repo is readable and `src/index.js` resolves
   - `.git` identity is readable, so `bootCommit` will not be `null`
   - the repo `.env` is readable
   - `C:\Aroma\secrets\google-*.json` are readable
   - the production data paths have the required **effective** write access
   - all three install-time values are `PRESENT` (names only, never values)
   - the stable runtime contract still equals the launcher contract

3. **Only after the preflight passes**, the ownership cutover, on the real port 8090:

4. Stop the interactive owner **first**.
5. Start the service owner.
6. Prove: `/health` reports `service: aroma-hub`, `status: ok`, `bootCommit` equal to the
   current production SHA, the listening PID owned by the service, and a normal read path works.
7. **Roll back immediately if any of that fails** — do not investigate with production down.

Port 8090 is never owned concurrently, because step 4 precedes step 5.

**Rollback:** `Stop-Service` → `Set-Service -StartupType Disabled` → run the interactive
launcher once → prove `health=ok` and `bootCommit` equals the deployed SHA.

Repointing the Startup shortcut at `xiangxiang-client.ps1` is a separate step after the service
is proven. Until then the old launcher remains the owner, which is why it still starts node and
why its canary line is untouched.

## ACL plan — NOT EXECUTED

`LocalService` will require, and no more than:

| Access | Path | Why |
|---|---|---|
| Read + Execute | `C:\Aroma\aroma-agent-backend` (code) | run the application |
| Read | `C:\Aroma\aroma-agent-backend\.git` | `bootCommit` reads `.git/HEAD` |
| Read | `C:\Aroma\aroma-agent-backend\.env` | dotenv resolves OpenAI / Aroma System / GitHub keys |
| Read | `C:\Aroma\secrets\google-*.json` | Drive / Gmail / Calendar auth, resolved by absolute path |
| Read | `C:\ProgramData\AromaXiangXiang\config\service.env` | the three install-time values |
| **Read + Write** | only the paths the running application genuinely writes — `data\`, its conversation store, and the log directory | the store must stay the production one |

⛔ **No broad write on the repo.** The service must not be able to modify code it is running;
that is the difference between a runtime account and a deployment account. Grants are
per-directory and verified as effective access before cutover.

## Headless failure visibility

`Notify-Owner` uses a blocking `MessageBox`, which a Session 0 service cannot show. Under v2 a
startup failure is observable through:

- **the preflight line** — `[AROMA-SERVICE] preflight FAILED HUB_TOKEN=ABSENT …` on stderr,
  naming the missing key and never its value
- **WinSW stdout/stderr logs** at `C:\ProgramData\AromaXiangXiang\logs`, rotated by size
- **SCM state** — bounded restarts, then `STOPPED`, so a broken build stops instead of looping
- **the interactive client at next logon** — it reports `CLIENT_STATE=down` and says so, and
  cannot paper over the failure by starting a server

`HEADLESS_REMOTE_NOTIFICATION = OPEN`. Nothing here reaches the Owner while he is away — no
mail, no push, no phone. That gap is stated rather than papered over, and it is **not** a
reason to keep a second server owner; a fallback server would trade a visible outage for a
silent split brain.

## Two refusals the installer must expect

**The tree must be on `main`.** The service reads `.git/HEAD` and starts only for
`ref: refs/heads/main`. A feature branch, a detached HEAD, or a HEAD that is missing, unreadable
or malformed all refuse — and **nothing is checked out, reset or repaired**. That is deliberate:
on 2026-08-19 the launcher's equivalent guard turned a reboot-while-parked-off-main into a 1h46m
outage, and the lesson recorded then was to put the tree back as part of finishing, not to let an
unattended process move the Owner's working tree. If the service will not start, check the branch
guard line in the log first; it names the state and, where one exists, the ref.

**A configured `service.env` must be readable.** If `AROMA_SERVICE_ENV_FILE` is unset, the three
install-time values may come from the machine environment. If it *is* set, that file is the source
of truth and must open — a wrong ACL is precisely what this arrangement exists to surface, so
ambient credentials are **not** allowed to stand in for a file the installer chose. Diagnostics
report `configured` / `UNREADABLE` / `REJECTED` / `OK` and key names only; the underlying
exception and path are discarded rather than logged.
