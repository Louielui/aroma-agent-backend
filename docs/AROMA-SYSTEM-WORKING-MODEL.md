# Working on `aroma-system` — the shape, and the wall

**Design only. NOTHING BUILT. No credentials requested, no VPS contact.**
Measured 2026-08-05 on AromaBrain, read-only.

`aroma-system` is production. The restaurant runs on it daily. Everything the Agent Bridge
governance assumes — that the worst case is a bad diff in a throwaway clone with no remote —
stops being true the moment the target is that repo. See `GOVERNANCE-BROWSER-VS-FILE.md`
§「THE CONDITION IS THE REMOTE」.

---

# PART 1 — STANDING PROPERTY: AromaBrain cannot deploy, and that is the point

> ## ⛔ DO NOT "FIX" THIS.
> **AromaBrain has no SSH key. `~/.ssh` contains `known_hosts` only, and that file names a
> single host: `github.com`. No private key exists anywhere under the user profile. This
> machine has never connected to the VPS.**
>
> **That is not an inconvenience. It is the only structural wall between the restaurant
> system and anything automated on this machine.** A future reader who finds "no SSH key"
> and treats it as missing setup would remove the wall without ever deciding to.

Recorded because it is exactly the kind of fact that reads as an oversight. It is a property.

## What can and cannot happen from AromaBrain, measured

| step | here? | evidence |
|---|---|---|
| edit, commit | ✅ | `AromaBrain\louis` has FullControl; working tree clean |
| push to GitHub | ✅ | `git:https://github.com` credential present; fetch verified. **Write scope not proven** — a dry-run on an up-to-date branch does not exercise it |
| open a PR | ⚠️ browser only | `gh` is **not installed** |
| **fetch / reset / build / `pm2 reload` / regression / `mysqldump` / tag** | ❌ | **no key, no VPS host in `known_hosts`** |

The VPS half needs whatever holds VPS shell access — the Manus cloud machine, or the Owner's
own terminal.

---

# PART 2 — THE NO-REMOTE CLONE (Owner-approved as the shape; design before building)

> **Owner ruling:** 「The agent works in a clone with origin removed and delivers a patch.
> Push is mine because he has nowhere to push, not because he was told not to. Same
> discipline as the throwaway clone — make the consequence disappear rather than making the
> mistake impossible.」

## The property being restored

Not a new control. The **same** control the Agent Bridge already had, put back where it went
missing:

| | Agent Bridge clone | `aroma-system` as it sits today | the proposed clone |
|---|---|---|---|
| remote | removed | `origin` present | **removed** |
| credential reachable | none | Credential Manager | **none — no origin to use it against** |
| `push` is | impossible | permitted | **impossible** |
| deliverable | a patch | a pushed branch | **a patch** |
| worst case | a diff nobody applied | a ref production resets to | **a diff nobody applied** |

## Design questions to settle BEFORE building

1. **Where the clone lives.** Not inside `C:\Users\louis\Projects\` — a sibling of the real
   repo is the single most likely path confusion. A scratch root, named so it cannot be
   mistaken for the working copy.
2. **How it is made.** `git clone --no-hardlinks` from the local repo, then
   `git remote remove origin`, then **assert zero remotes** and fail closed if any remain.
   The assertion is the control; the removal is just a step.
3. **What the sealed order gains.** `allowedFiles`, `branch`, `forbiddenActions` all carry
   over unchanged. What is missing today is a field naming **which repo** the order is
   against — the order shape assumes one target, exactly as it assumes one identity.
4. **What the patch is, exactly.** A `git format-patch` series or a plain diff — and whether
   the Owner applies it to the real repo himself or reviews it in place. His action either
   way; the agent never touches the repo that has the remote.
5. **Whether the clone is destroyed after.** The throwaway clone's other half was that
   deletion ended the consequence. A clone kept "for next time" quietly stops being
   disposable.
6. **What happens to `.claude/settings.local.json`.** 399 pre-allowed entries live in the
   production repo, including `Bash(git push *)`. A clone inherits the file. **Decide
   deliberately** whether the clone carries it — see `PERMISSIONS-AUDIT-AROMA-SYSTEM.md`.

## What this does NOT solve

The clone protects against a misdirected **edit**. It does nothing about a **correct patch
that is wrong for the restaurant** — that is what review, staging and the deploy ritual are
for, and staging is currently broken (`DEFECT-003`).

---

# PART 3 — DEPLOY, EVENTUALLY OFF THE MANUS MACHINE

> ## ⚠ THIS IS A DESIGN, NOT A PLAN.
> **Owner, 2026-08-05: 「I am not building a deploy path this week.」** Recorded so a later
> reader does not find a worked-out design and mistake it for scheduled work.

## The question that was actually being asked, and its answer

> **Does removing the Manus step necessarily degrade the wall?**
>
> ### No — conditional on replacing it with something structural rather than with a button.
> **That is the whole finding. It was enough for now, and nothing follows from it
> automatically.**

> **Owner:** 「today the manual step through Manus is slow, but it is the only physical wall
> between the restaurant system and anything automated. Removing it converts 『cannot deploy
> to production』 from a mechanism into an intention.」

Correct, and it is the same degradation as the remote.

## The correction to the proposed shape — the Owner's own words

The proposal was: sealed order → typed EXECUTE → audit both sides → nothing reaches the VPS
without that.

> ### 「I offered the gate and left the fence behind, and the fence was always what carried the weight.」

That is the finding, and it is the same one as the remote in a third place:

| | | |
|---|---|---|
| **the gate** | sealed order, nonce, TTL, typed EXECUTE | an authorisation |
| **the fence** | disposable clone, no remote | **the structural half — the one that carried it** |

Port only the gate to production and you have taken the decorative half. And a typed EXECUTE
is a **client event** — this project has already measured two cases where one never reached
the server (the stale-tab reject; the offer discarded by dispatch ordering). A UI event
cannot be the wall.

## ACCEPTED AS THE SHAPE

> **Owner:** 「VPS pulls, never receives; deploys only a ref I signed; the signing key lives
> where I type and nowhere an agent can reach; migrations cannot ride the automated line at
> all.」

### The sentence to keep

> ## 「三樣都係『唔可能』，唔係『唔准』。」
> **All three are "impossible", not "not permitted".**
>
> That is the test any replacement for the Manus step has to pass. A button passes none of
> it.

## What would keep the wall structural

Move the control from **the channel** to **the artifact**.

1. **The VPS pulls; it is never pushed to.** It already can — the VPS→GitHub deploy key
   exists. Then 「nothing reaches the VPS」 is literally true: no inbound endpoint, no
   webhook, no listening socket, no SSH from AromaBrain. The trigger is a poll.
2. **Deploy only a ref carrying an Owner signature**, with the signing key existing **only
   where the Owner types** — not on AromaBrain, not in any agent environment. Then deploying
   an unapproved commit is not forbidden, it is **unverifiable**, and the script refuses
   because the signature is absent. *This is the exact analogue of the clone with no remote:
   the capability is absent from where the agent works.*
3. **The automated lane physically cannot carry a schema change.** The script refuses any ref
   whose diff touches migrations. **A code rollback does not undo a schema change** — that is
   the line between an honest rollback and a claimed one. Schema changes stay manual.

## What already exists on the VPS — more than expected

The deploy machinery is essentially finished. `scripts/deploy.sh` (149 lines, on the unmerged
branch `origin/fix/deploy-sh-branch-resolution`) already does:

| exists | |
|---|---|
| self-pull | VPS→GitHub deploy key |
| build | `pnpm install --frozen-lockfile` → `npm run build` |
| restart | `pm2 reload ecosystem.config.cjs --only aroma-system` (reload, not restart — correct) |
| **code** save point | tags `safety/pre-deploy-<env>-<ts>` before touching anything |
| post-deploy verification | `/home/ubuntu/scripts/aroma-regression-check.sh` |
| rollback mode | finds the prior safety tag, `reset --hard`, rebuild |
| a human gate | `CONFIRM=YES` |

## What is actually missing

Not the pull, build, restart, verification or rollback. Those exist.

| missing | why it matters |
|---|---|
| **a trigger the Owner can operate without Manus** | the only genuine gap |
| **a signature the VPS can verify** | today **nothing** distinguishes an Owner-approved commit from any commit on `main` |
| **auto-rollback on regression failure** | the script reloads **first**, then tests, then merely *reports* failure and exits 1. **The bad version stays live** until a human notices. Tolerable with the Owner watching; not for an unattended deploy |
| **a DB save point in the script** | the ritual requires `mysqldump`; `deploy.sh` tags git only |
| **migration exclusion for the automated lane** | see above |
| **safety tags pushed** | `DEFECT-002` |
| **a two-sided audit** | the VPS side keeps no durable record off the machine |
| **`deploy.sh` merged to `main`** | the tool that would be automated is not on the branch production deploys from |

## Identity, tying back

An automated deploy acts **as the Owner** toward the restaurant system — case 3 of
`DESIGN-IDENTITY-DIMENSION.md`. The audit must separate **`approvedBy`** (who signed) from
**`actedAs`** (a machine, at time T, under that signature). Today's single `who` field cannot
carry both, and this is a second concrete place where that defect surfaces.
