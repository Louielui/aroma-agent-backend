# What is pre-allowed in the PRODUCTION repo

**REPORT ONLY. Nothing changed. Owner decision.**
Source: `C:\Users\louis\Projects\aroma-system\.claude\settings.local.json`, read 2026-08-05.
Full verbatim list: `permissions-aroma-system-full-list.txt` (399 entries, in file order).

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
