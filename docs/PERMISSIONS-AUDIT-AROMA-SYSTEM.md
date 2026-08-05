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
