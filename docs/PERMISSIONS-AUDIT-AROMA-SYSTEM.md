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

## Group D — genuinely broad, and I would narrow rather than delete · **~8 entries**

These are the ones worth a decision rather than a sweep:

| entry | what it actually permits | suggestion |
|---|---|---|
| `Bash(git checkout *)` | **silently discards uncommitted work** in a working copy | remove; it is the same loss class as `reset --hard` |
| `Bash(pnpm add *)` · `Bash(npm install *)` | installs **arbitrary packages** from the public registry into production's tree | keep `pnpm install` (lockfile-driven, no args), drop `add` |
| `Bash(npm run *)` | runs **any** script in `package.json`, including `build` | narrow to the scripts actually used |
| `Bash(taskkill //F //IM node.exe //T)` | kills **every** node process on the machine, including 8090 | remove — nothing in aroma-system dev needs it |
| `Bash(rm -rf __TRACKED_VAR__/stagetest/*)` | a granted `rm -rf` containing an **unexpanded placeholder** | remove |
| `Bash(git stash *)` · `Bash(git commit *)` | wildcard forms of writes | narrow or leave; lower risk than the above |

## What I would NOT remove without being told

The ~25 loopback `curl` entries **for aroma-system's own ports** (`localhost:3001`), the
domain-scoped `WebFetch` list, and the test-runner entries. They are ordinary development.

## The structural point, which outlives any pruning

**A 399-entry allow list is not reviewable, and an unreviewable list is where a `git push *`
hides for months.** The durable fix is not a shorter list — it is that the clone carries no
list at all and the fence is environmental. See `AROMA-SYSTEM-WORKING-MODEL.md` Part 2.
