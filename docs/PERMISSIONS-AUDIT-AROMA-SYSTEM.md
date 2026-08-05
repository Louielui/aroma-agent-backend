# What is pre-allowed in the PRODUCTION repo

Source: `C:\Users\louis\Projects\aroma-system\.claude\settings.local.json`, read 2026-08-05.
Full verbatim list as first captured: `permissions-aroma-system-full-list.txt` (399 entries).

> ## ✅ ACTED ON — Owner ruling, 2026-08-05
>
> The audit below was report-only. **The Owner then ruled, and the file has been changed.**
> Backup of the original: `scratchpad/settings.local.json.bak-20260805` (57,561 bytes).
>
> **Removed from `allow` — exactly three, nothing else:**
> 1. `Bash(git push *)` — 「the mechanism-to-intention line lives here」
> 2. `Read(//c/Aroma/aroma-agent-backend/**)` — the contamination in writing
> 3. `Read(//c/Users/louis/.ssh/**)` — 「a permission that reads them is pointed at the wall」
>
> **Added a `deny` list — 20 entries**, per 「at minimum anything that would deploy, restart
> PM2, or touch the database」:
>
> | group | entries |
> |---|---|
> | PM2 | `pm2`, `pm2 *`, `sudo pm2 *`, `npx pm2 *` |
> | remote shell (how a deploy would happen) | `ssh *`, `scp *`, `sftp *`, `rsync *` |
> | database | `mysql *`, `mysqldump *`, `mysqladmin *`, `drizzle-kit *`, `npx drizzle-kit *`, `pnpm drizzle-kit *`, `pnpm db:push *`, `npm run db:push *` |
> | the deploy script itself | `./scripts/deploy.sh *`, `bash scripts/deploy.sh *`, `sh scripts/deploy.sh *` |
> | the wall | `Read(//c/Users/louis/.ssh/**)` |
>
> Counts after: **allow 396, deny 20, ask 0**, JSON parses.
>
> ### The deny was VERIFIED to fire, not assumed
> An unmatched deny rule is decoration that reads as protection — the exact defect class this
> project keeps removing. So it was tested: `pm2 --version` was **refused**. Other
> non-allowlisted commands ran normally throughout the same session, so the refusal came from
> the deny rule rather than from the permission mode.
>
> **Not done, and not proposed as done:** `Bash(git push *)` was removed from `allow` but NOT
> added to `deny` — that was outside the Owner's ruling. It now prompts rather than refuses.

> **Owner:** 「`git push *` pre-allowed there while the safe repo has no config at all is
> backwards and I did not know it existed.」

---

## The shape of it

| | |
|---|---|
| total entries | **399**, one `allow` list |
| `deny` list | **none** |
| `ask` list | **none** |
| entries ending in a wildcard | **64** |
| where it lives | **only** in the production repo. `aroma-agent-backend` has no settings file at all |

The file is an **accretion**: it grew one approval at a time across many sessions, and
nothing has ever removed an entry. Several are one-off shapes from a single past task that
will never be used again but remain permanently granted.

## The entries that matter

### Git writes — 6, all wildcards

```
Bash(git push *)          Bash(git commit *)      Bash(git add *)
Bash(git checkout *)      Bash(git commit -m ' *) Bash(git stash *)
```

`git push *` is the one the Owner named. `git checkout *` deserves equal attention: in a
working copy it can **discard uncommitted work silently**, and `deploy.sh` on the VPS relies
on `reset --hard` semantics that make the same class of loss routine.

### ⚠ The contamination mechanism, in writing

```
Read(//c/Aroma/aroma-agent-backend/**)
```

**The production repo's permission file is what has been granting access to the 香香 repo.**
Every session of 香香 work has been running under production's configuration. This is the same
defect as the missing `CLAUDE.md`, in a second place, and it is the concrete artefact of it.

Also reaching outside the repo — 14 `Read()` grants in total:

```
Read(//c/Users/louis/.ssh/**)                  ← the SSH directory
Read(//d/AromaCoreBackups/...)                 ← the offsite backup tree
Read(//c/ProgramData/AromaBackup/**)           ← the backup toolchain
Read(//c/Users/louis/Downloads/m1/**)          ← four separate m1 grants
Read(//c/Aroma/staging/xiangxiang-service/...)
Read(//c/Users/louis/Projects/aroma-frontend/src/data/**)
```

### Destructive — 7

Five are narrowly scoped to a specific temp path (harmless, and now stale). Two are broader:

```
Bash(taskkill //F //IM node.exe //T)     ← kills EVERY node process, including 8090
Bash(rm -rf __TRACKED_VAR__/stagetest/*) ← an unexpanded variable in a granted rm -rf
```

The second is worth a look on its own: a wildcard `rm -rf` whose path contains a literal
`__TRACKED_VAR__` placeholder.

### Package and script execution — 10, mostly wildcards

```
Bash(pnpm add *)   Bash(npm install *)  Bash(npm run *)   Bash(pnpm exec *)
Bash(npx vitest *) Bash(pnpm install *) Bash(npm test *)  Bash(pnpm dev *)
```

`pnpm add *` and `npm install *` install **arbitrary packages** from the public registry into
the production repo. `npm run *` runs **any** script in `package.json`, including build.

### Network — 25 curl/Invoke-WebRequest entries

All observed targets are **loopback** (`127.0.0.1:8081/8090/18099`, `localhost:3001`). No
grant reaches an external host. `WebFetch` is domain-scoped across 11 entries (github.com,
docs.claude.com, openai.com and similar) plus one bare `WebSearch`.

### Not present, and worth stating

- **No `pm2`, no `deploy`, no `ssh`/`scp` execution grant.** The three ssh-shaped entries are
  `command -v ssh`, `ssh -V` and reading `~/.ssh` — capability probes, not use.
- **No database or `mysql` grant of any kind.**

---

## The asymmetry, stated plainly

| repo | risk | config |
|---|---|---|
| `aroma-system` | **production** — has `origin`, and its `main` is what `deploy.sh` resets the live system to | **399 pre-allowed entries, 64 wildcards, no deny list** |
| `aroma-agent-backend` | local, loopback only | **no settings file at all** |

The permissive configuration is attached to the dangerous repo, and the safe one has none.

## Options — the Owner's decision, none taken

1. **Remove `Bash(git push *)`.** Push becomes a per-use approval. Cheap, and it is the
   entry he named.
2. **Remove `Read(//c/Aroma/aroma-agent-backend/**)`** so 香香 work stops depending on
   production's config. Pairs with the new `CLAUDE.md` there.
3. **Prune the accretion.** Most of the 399 are one-off shapes from finished tasks.
4. **Add a `deny` list.** There is none today, so nothing is explicitly forbidden — only
   un-granted, which prompts rather than refuses.
5. **Do nothing yet**, and let the no-remote clone carry the weight instead — the mechanism,
   where this list is only a rule. Note the clone would **inherit this file** unless that is
   decided deliberately.

**Recommendation:** 1 and 2 now, because both are narrow and one of them is the contamination
itself. 3 and 4 are housekeeping and can wait. But **do not treat any of them as a substitute
for the clone** — a permission list constrains the mistake; the clone removes the
consequence.

---

# ✅ SECOND RULING EXECUTED — groups A, B, C removed 2026-08-05

Backup before this pass: `scratchpad/settings.local.json.bak2-pre-groupABC`.

| | |
|---|---|
| allow | **396 → 273** (removed **123**; the three groups overlap by 16) |
| deny | 20, unchanged |
| ask | 0 |
| group D | **verified intact** — every entry still present, including the `taskkill` and the `__TRACKED_VAR__` `rm -rf` |
| residual `8090`/`8081`, `m1`, dead-session entries | **0** |

**No false positives.** 33 entries in the removal set contain the literal string
`aroma-system` — but only because the expired temp-session directory is named
`C--Users-louis-Projects-aroma-system`. Every one was verified to be group B, not
development work.

## ⚠ MY 「69」 WAS LOW — 72 MORE OF GROUP A REMAIN, AND I HAVE NOT TOUCHED THEM

The first count used a narrower pattern than the Owner's own definition. Group A is
「香香's work leaked into production's config」, and by that definition **72 entries remain**:

| kind | count | example |
|---|---|---|
| `node --test` runner invocations | 26 | `Bash(node --test test/runtime/bindConfig.test.js)` — `aroma-system` uses **vitest**; `node --test` is the agent repo's runner |
| core-memory / `AromaCore` | 23 | `Bash(export AROMA_CORE_DIR="C:/Users/louis/AromaCore/core-data")` |
| intake & distill | 19 | `Bash(node --test src/intake/distillPrompt.test.js)` |
| truth store / cli | 4 | `Bash(node -e "…require('./data/aroma-truth.json')…")` |

**Not removed, deliberately.** The Owner authorised 「group A — all 69」 against a number I
gave him; removing 72 more on the same authority would be quiet scope-widening, which is the
habit this project exists to remove. **They are listed here for a ruling.**

`node --test` is the cleanest signal in the whole file: this repo does not use it.

---

# WHAT ELSE I WOULD REMOVE — proposal only, NOTHING TOUCHED

**Owner: 「I want to see the list before shrinking it further — a permission I do not
understand the purpose of is not automatically safe to delete.」** So this is grouped by
*reason*, and every group says what it was for. Of the 396 remaining, I would remove about
**120**, in four groups. **None of it is done.**

## Group A — 香香 work that leaked into production's config · **69 entries**

**The entry the Owner named was one of sixty-nine.** `Read(//c/Aroma/aroma-agent-backend/**)`
is removed, but the same class is all over the file:

```
Bash(node --test src/persona/xiangxiang.test.js)
Bash(curl -s http://127.0.0.1:8081/health)               ← 香香's port, not aroma-system's
Bash(curl -s --max-time 30 http://127.0.0.1:8090/...)    ← 香香's port
Bash(VITE_XIANGXIANG_DEMO=on npm run dev)
Bash(timeout 8 node companion-entry.js testpipe123)      ← Computer Operator canary
Read(//d/AromaCoreBackups/...)   Read(//c/ProgramData/AromaBackup/**)
Read(//c/Aroma/staging/xiangxiang-service/...)
```

**Why they exist:** every one was approved during a session whose cwd was this repo while the
work was elsewhere. They are the accumulated residue of the missing `CLAUDE.md`. **Now that
`aroma-agent-backend` has its own, these belong in its own settings file if anywhere.**

## Group B — dead one-off paths · **33 entries**

All naming a single expired temp session (`cbe7b6c4-f4e5-…`), including five granted
`rm -rf` on paths that no longer exist. Harmless, and pure noise — but noise is what made a
399-entry list impossible to review, which is how the three real ones stayed unnoticed.

## Group C — a finished task · **19 entries**

The `m1` evaluation (`Read(//c/Users/louis/Downloads/m1/**)` and four variants, plus a long
`cd ~/Downloads/m1/... && cat README.md …` one-liner). The task is over.

## Group D — KEPT by ruling. What each is actually for, and a narrower form where one exists

**Owner: 「do not remove, but report each with what it is actually needed for. If a narrower
form covers the real use, propose it.」** Nothing here has been touched.

### `Bash(git checkout *)` — **convenience that outlived its reason**

**Asked about specifically.** Its real daily uses are three, and each has a narrower form:

| the actual use | narrower form |
|---|---|
| switch branch | `Bash(git switch *)` — cannot touch files, only refs |
| inspect another branch's file | `Bash(git show *)` — writes nothing at all |
| discard a file's changes | *(this is the dangerous one, and it is the rarest)* |

`git checkout -- <path>` **silently discards uncommitted work with no undo and no
confirmation** — the same loss class as `reset --hard`. Under the no-remote clone design, the
agent will not be editing a working copy the Owner also uses, which removes the last argument
for keeping the broad form.

> **Proposal: replace with `Bash(git switch *)` + `Bash(git show *)`.** The discard case
> should prompt, because that is precisely the moment someone should be asked.

### `Bash(npm run *)` — **legitimate daily purpose, but broader than the purpose**

**Asked about specifically.** This one is genuinely used: `check`, `build`, `dev`, `test`
are the everyday loop of this repo, and the Owner's own deploy ritual runs
`pnpm --filter client build`. So it is **not** convenience that outlived its reason.

But `npm run *` grants **every** script in `package.json`, including any added later —
a permission that silently widens whenever the file changes.

> **Proposal: enumerate.** `Bash(npm run check*)`, `Bash(npm run build*)`,
> `Bash(npm run dev*)`, `Bash(npm run test*)`. Same daily loop, and a new script does not
> arrive pre-approved. Note `npm run db:push *` is already in the **deny** list, and a deny
> beats an allow — that combination stays correct either way.

### `Bash(taskkill //F //IM node.exe //T)` — **the clearest case for narrowing**

**The Owner named this one, and he is right.** `//IM node.exe //T` matches *every* node
process on the machine — **including 香香 on 8090**, including any editor language server.
Its real purpose was freeing port 3001 when a dev server was left running.

> **Proposal: narrow to the port, not the image name.** Kill by PID resolved from the port
> (`netstat -ano` is already allowed and is how the PID is found), rather than by process
> name. Killing everything named `node.exe` to free one port is a sledgehammer that has
> already been pointed at 8090 without anyone intending it.

### `Bash(pnpm add *)` · `Bash(npm install *)` — supply chain

Installs **arbitrary packages** from the public registry into production's tree. The real
daily need is restoring dependencies, which is lockfile-driven.

> **Proposal: keep `pnpm install` (no args, lockfile-driven), drop `add`.** Adding a
> dependency to production should be a decision, not a pre-approval.

### `Bash(rm -rf __TRACKED_VAR__/stagetest/*)` — a placeholder in a granted `rm -rf`

The variable was never expanded, so what this actually grants depends on how the matcher
treats the literal. Its target no longer exists — **and that is the Owner's own point: a
permission whose target could be recreated later by something else.**

> **Proposal: remove.** This is the one group D entry with no legitimate current use.

### `Bash(git stash *)` · `Bash(git commit *)`

Wildcard write forms, materially lower risk than the above: `stash` is recoverable,
`commit` creates rather than destroys.

> **Proposal: leave.** Not worth spending a decision on.

## What I would NOT remove without being told

The ~25 loopback `curl` entries **for aroma-system's own ports** (`localhost:3001`), the
domain-scoped `WebFetch` list, and the test-runner entries. They are ordinary development.

## The structural point, which outlives any pruning

**A 399-entry allow list is not reviewable, and an unreviewable list is where a `git push *`
hides for months.** The durable fix is not a shorter list — it is that the clone carries no
list at all and the fence is environmental. See `AROMA-SYSTEM-WORKING-MODEL.md` Part 2.

---
---

# THIRD PASS — the 72 removed, group D ruled, and a FOURTH pocket found

Backup before this pass: `scratchpad/settings.local.json.bak3-pre-72-and-D`.

## Executed

| | |
|---|---|
| removed as "the 72" | **73** — one more than reported, because the pattern was widened to `decisionRecall`/`bindConfig`/`artifactDir`, which are agent-repo modules under the same definition |
| removed by group D ruling | **7** |
| added by group D ruling | **9** |
| **allow** | **273 → 202** |
| deny / ask | 20 / 0, unchanged |

### Group D, as ruled

| removed | replaced with | why |
|---|---|---|
| `Bash(git checkout *)` | `Bash(git switch *)` · `Bash(git show *)` | refs and reads only; **the discard case now prompts**, which is the moment to ask |
| `Bash(npm run *)` | `npm run check*` · `build*` · `dev*` · `test*` | a new script in `package.json` no longer arrives pre-approved |
| `Bash(taskkill //F //IM node.exe //T)` | `Bash(taskkill //F //PID *)` | kill the port's PID, not every `node.exe`. `netstat -ano` (already allowed) is how the PID is found |
| `Bash(pnpm add *)` · `Bash(npm install *)` · `Bash(pnpm install *)` | `Bash(pnpm install)` · `Bash(pnpm install --frozen-lockfile)` | **`pnpm install *` was removed too**: the wildcard admits `pnpm install <package>`, which is `add` under another name and would have defeated the ruling |
| `Bash(rm -rf __TRACKED_VAR__/stagetest/*)` | — | no current use |

---

# ⚠ ANSWER TO 「does any category remain?」 — YES. 57 more, in three pockets

**Not removed.** Reported, as instructed.

## Pocket 4 — release-records, backup and disk automation · **17**

```
Bash(powershell.exe … Start-ScheduledTask -TaskName 'AromaReleaseRecords-B2Sync')
Bash(cmd //c "C:\Users\louis\AppData\Local\Aroma\aroma-releaserecords-sync.cmd")
Bash(RCLONE="/c/Users/louis/AppData/Local/Aroma/bin/rclone.exe" *)
Bash(powershell.exe … -File "C:\Aroma\diagnostics\query-events.ps1")
Bash(powershell.exe … Get-Disk / Get-Volume / Win32_DiskDrive / Get-PnpDevice)
```

The offsite-backup and scheduler work. Nothing to do with this repo.

## Pocket 5 — agent-backend source, flags, ports and PRs · **34**

```
Bash(node -e "…require('./src/context/googleAuth')…")     ← agent repo module
Bash(node -e "…require('./src/agent/agentAuthorization')…")
Bash(node -e "…require('./src/routing/modelRouter')…")
Bash(unset ANTHROPIC_API_KEY LLM_PROVIDER DECISION_RECALL WORKER_INVOCATION …)   ← ×8 variants
Bash(gh pr create --base main --head feat/agent-bridge-v0 …)                     ← an Agent Bridge PR
PowerShell(Get-NetTCPConnection -LocalPort 8090 …)                               ← 香香's port
Bash(where.exe claude *) · Bash(claude --version) · Bash([ -d "$HOME/.claude" ])
```

The `curl` calls to `:8090` were removed in pass two; **these reach the same process by a
different route.** Same defect, third spelling.

## Pocket 6 — fragments and a dead placeholder · **6**

```
Bash(break)   Bash(r?)   Bash(echo)   Bash(exit 0)   Bash(system)
Bash(mkdir -p __TRACKED_VAR__/stagetest)
```

Not commands — fragments captured by the approval prompt. **And the `mkdir` is the partner of
the `rm -rf` just removed, with the same unexpanded `__TRACKED_VAR__` placeholder.** Deleting
one of a pair is how a hazard survives a cleanup.

---

# THE REAL FINDING — the method is wrong, not the count

**Three passes, three answers, and each pattern only found what the previous one missed.**
The Owner asked whether a fourth pocket exists. It does — and the important part is that
**this method cannot tell him when it is done.** Classifying by what should *not* be there
means the next pass depends on imagining a spelling nobody has thought of yet.

> ## The inverse is bounded, and this one is not.
> **Keep only what is provably `aroma-system` development. Everything else re-prompts.**

Measured against the current 202:

| | |
|---|---|
| provably aroma-system development | **~45** — `localhost:3001`, vitest, `client/`, `server/`, drizzle, `package.json`, the git verbs, domain-scoped `WebFetch` |
| everything else | ~157, of which 57 are already identified above and the rest are generic shell (`echo "exit: $?"`, `xargs wc -l`) that costs nothing to re-approve |

**A permission that is genuinely needed is re-approved in seconds. One that is not never
comes back.** That converts an unbounded audit into a single bounded decision — and it is the
only version of this that ends.

**Not done. Proposed.** The Owner has ruled three times on lists I produced; this is the
fourth, and it should be the last one, because it is the only one whose completeness does not
depend on my pattern-matching.

---
---

# ✅ THE INVERSION — executed 2026-08-05. Permissions closed.

Backup before this pass: `scratchpad/settings.local.json.bak4-pre-inversion`.

> **Owner: 「An allow list should be able to say when it is finished, and only the inversion
> can.」**

| | |
|---|---|
| allow | **399 → 31** over four passes (**202 → 31** in this one) |
| deny | 20 |
| ask | 0 |

## The kept list, in full — 31 entries

**Read, not counted.** The Owner asked to see it because 「a list I have read once is worth
more than a list I approved a count for」.

**Test & check (6)**
```
Bash(npx vitest *)        Bash(npm test *)
Bash(npm run check*)      Bash(npm run test*)
Bash(pnpm -s check)       Bash(pnpm check *)
```
**Build & run (7)**
```
Bash(npm run build*)      Bash(npm run dev*)      Bash(pnpm dev *)
Bash(timeout 45 pnpm dev) Bash(pnpm exec *)
Bash(pnpm install)        Bash(pnpm install --frozen-lockfile)
```
**This repo's own script (1)**
```
Bash(node --check scripts/postbuild.mjs)
```
**Health checks against the local dev server (3)**
```
Bash(curl … http://localhost:3001/api/health)
Bash(curl … http://localhost:3001/api/v1/health)
Bash(curl … http://localhost:3001/api/v1/__nope__)
```
**Git — reads, refs and creates. No push, no checkout, no reset (8)**
```
Bash(git switch *)   Bash(git show *)    Bash(git add *)     Bash(git commit *)
Bash(git stash *)    Bash(git pull *)    Bash(git check-ignore *)
Bash(git -c core.safecrlf=false diff package.json)
```
**Port hygiene — the narrowed pair (2)**
```
Bash(netstat -ano)        Bash(taskkill //F //PID *)
```
**Network (4)**
```
WebFetch(domain:github.com)  WebFetch(domain:raw.githubusercontent.com)
WebFetch(domain:docs.claude.com)  WebSearch
```

## Reading the list caught nine more that the pattern kept

The candidate set was **42**. Going entry by entry — which is what the Owner asked for and
what a count would have skipped — dropped nine:

| dropped | why |
|---|---|
| `gh pr create --base main --head fix/windows-cross-platform-dev …` | a spent one-off for a branch merged 2026-07-06, and `gh` is not installed |
| `gh api *` | very broad, can **write** to GitHub (releases, refs), and unused |
| `WebFetch` × 7 — openai.com, platform/developers.openai.com, developer.chrome.com, wicg.github.io, chromestatus.com, groups.google.com | model and browser research: **other work**, not this repo |
| `Read(//c/Users/louis/Projects/aroma-frontend/src/data/**)` | a different project directory, outside this repo |
| `Bash(git commit -m ' *)` | duplicate of `Bash(git commit *)` |

**That is the argument for reading a list, made by the list itself.** A pattern that keeps
「anything WebFetch」 keeps browser research in a restaurant repo's config.

## What is deliberately absent

No `push`. No `checkout`/`reset`/`clean`. No `add`/`install <package>`. No `npm run` wildcard.
No reads outside the repo. **The list will rebuild from actual use, and each addition will be
a decision someone made once, on purpose.**

---

# TWO ILLUSTRATIONS WORTH MORE THAN THE COUNTS

**Owner instruction: record these beside the method finding.**

## 1. `LocalPort 8090` — the third spelling of one contamination

Pass two removed every `curl` to `127.0.0.1:8090`. Pass three found
`PowerShell(Get-NetTCPConnection -LocalPort 8090 …)` — **the same process, reached by another
route, surviving because it did not look like the pattern.** One contamination, three
spellings, two passes apart.

## 2. The `mkdir` that was the other half of the `rm -rf`

`Bash(rm -rf __TRACKED_VAR__/stagetest/*)` was removed by ruling. Its partner,
`Bash(mkdir -p __TRACKED_VAR__/stagetest)`, carrying the **same unexpanded placeholder**,
sat untouched two passes later because only one half matched.

> ### A dangerous pair surviving because one half matched a pattern is how the method fails.
> Better than any count: the cleanup was *correct* both times, and the hazard still had a
> half left standing.

## And the permission-file version of the standing finding

> **`pnpm install *` was the ruling degrading into decoration.**
>
> The Owner ruled 「keep `pnpm install` only」 — but the wildcard admits
> `pnpm install <package>`, which is `add` under another name. Left in place, the ruling
> would have read as enforced while permitting exactly what it forbade.
>
> **That is `forbiddenActions` degrading from mechanism to intention, in a permission file.**
> Same shape as the remote, the browser and the typed EXECUTE. Fourth instance.
