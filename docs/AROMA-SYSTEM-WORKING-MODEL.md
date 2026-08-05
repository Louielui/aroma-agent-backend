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

## THE ANSWERS — Owner ruling: answer the last one FIRST, because it decides the rest

### Q6 (FIRST) — does the clone inherit the 399 permissions?

> **Owner: 「If the clone inherits those 399 permissions, the fence is decorative. That one
> decides whether the rest is worth designing.」**

> ## Measured answer: NO. It does not inherit — by construction.

| check | result |
|---|---|
| `git ls-files .claude/` | **empty** — nothing under `.claude/` is tracked |
| `git ls-tree -r main` under `.claude/` | **0 files** |
| `git check-ignore -v` | matched by `**/.claude/settings.local.json` |

So `git clone` cannot carry it. **The fence is not decorative.** The rest is worth designing.

**Two caveats that matter more than the answer:**

1. **The ignore rule lives in the MACHINE-GLOBAL git ignore** (`~/.config/git/ignore`), not in
   the repo's own `.gitignore`. It is a property of this computer, not of the repository. On
   any other machine the file could be committed and would then travel. **One-line fix
   available: put the rule in the repo's `.gitignore` so the protection belongs to the repo.**
2. **The clone inherits neither the allows NOR the denies.** The 20 deny entries added today
   do not travel either. A fresh clone starts with no policy at all — and then accumulates a
   new list, exactly as this one did.

> **The conclusion those two force:** the clone's safety must come from **the environment
> (no remote)**, never from a config file — because the config does not travel and the
> environment does. Which is the whole argument, arriving from a direction I did not expect.
>
> If policy *should* travel, it belongs in a **tracked** `.claude/settings.json` — not
> `settings.local.json`. That is a separate decision.

### Q1 — where the clone lives

**Not a sibling of the real repo.** `C:\Users\louis\Projects\aroma-system-work\` sitting
beside `aroma-system\` is the single most likely path confusion, and HR-9 exists because that
class of confusion already happened once.

Proposal: **`C:\Aroma\worktrees\aroma-system-<approvalId>\`** — under the agent's own root,
never under `C:\Users\louis\Projects\`, with the approval id in the name so two dispatches
cannot collide and a stale clone identifies which order left it behind.

### Q2 — how it is made, and where the fence verdict comes from

```
git clone --no-hardlinks <local repo> <dest>
git -C <dest> remote remove origin
```

- **Clone from the LOCAL repo, not from GitHub** — no credential is used, so the clone has no
  network path for git at all.
- **`--no-hardlinks` is not cosmetic.** A default local clone hardlinks the object store, so
  the clone's `.git` shares storage with the real repo. Disposability should not depend on
  that being harmless.
- **The assertion is the control; the removal is only a step.** Verify with *two* checks,
  because a malformed entry can sit in config without listing:
  `git remote` returns empty **and** `git config --get-regexp '^remote\.'` returns nothing.
  Fail closed on either.
- That result is the **fence verdict**, and it is **sealed into the order** — verified at
  dispatch, not at registration. A fence checked once and assumed after is not a fence.

### Q3 — what the sealed order gains

`targetRepo` · `worker` · `identityCase` · `fence { claim, probe, verdict, verifiedAt }`.

Plus one easy thing to get wrong: **`allowedFiles` paths must be re-anchored to the clone
root**, not copied across verbatim. A path list that still points at the real repo is a
whitelist aimed at the wrong tree.

### Q4 — what the patch is

**`git format-patch` against the base commit recorded in the order**, not a bare `git diff`.
A diff with no base can be applied to the wrong tree and look like it worked; format-patch
pins the base and carries the message. The Owner applies it. **The agent never touches the
repo that has the remote** — that is the point, not a precaution.

### Q5 — is the clone destroyed afterwards

**Yes, and deletion is the default with an explicit retention flag — not the reverse.** A
clone kept "for next time" quietly stops being disposable, and the throwaway clone's other
half was always that deletion ended the consequence.

Retention, if used, lasts only until the patch is applied or rejected. **A fence verdict is
valid for one clone instance only**; a retained clone must be re-verified, never assumed.

---

## The original questions, for reference

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

---

# PART 4 — GETTING DEPLOYMENT OFF THE MANUS MACHINE

**Owner, 2026-08-05. NOT THIS WEEK.** Sequenced as **the next infrastructure item after
`DEFECT-003`** (staging). Recorded now because the shape was established today and would
otherwise have to be re-derived.

## The state today, stated precisely — the two are not the same claim

> **「We still use Manus」 and 「we use Manus for four commands」 are different states, and the
> second one is nearly done.**

| | status |
|---|---|
| **Development** | ✅ **off Manus as of 2026-08-05.** Code is written on AromaBrain, pushed to GitHub, merged by the Owner in the browser. |
| **Deployment** | **four commands remain**, and the Owner is running them tonight for `DEFECT-001`: `hostname` · `cd` + `git rev-parse HEAD` · the `mysqldump` save point · `CONFIRM=YES ./scripts/deploy.sh production origin/main` (plus `git push origin --tags`). |

That is the whole remaining dependency. Not a workflow — **four commands**.

## The shape, established today

1. **The VPS pulls; it is never pushed to.** It already can — the VPS→GitHub deploy key
   exists. No inbound endpoint, no webhook, no listening socket, no SSH from AromaBrain.
2. **It deploys only a ref the Owner signed.**
3. **The signing key lives where the Owner types, and nowhere an agent can reach.**

Then **Manus becomes optional rather than required**, which is the actual goal — not
"automated deployment".

## ⛔ WHAT THIS IS NOT

> ### It is NOT 「give AromaBrain an SSH key」.

**The absence of a key on this machine is the wall.** `~/.ssh` holds `known_hosts` and one
host, `github.com`; no private key exists under the user profile; this machine has never
connected to the VPS. Replacing that with a credential — or with a button — **is exactly the
degradation this project spent 2026-08-05 naming**:

> 「forbiddenActions 由機制退化成意向」 · 「I offered the gate and left the fence behind」

A signature the agent cannot produce keeps the property. A key on AromaBrain destroys it while
looking like progress, because the deploy would still be gated by a rule someone follows.

**The test, from the same day:** 「三樣都係『唔可能』,唔係『唔准』。」

## The four missing pieces — the Owner's own list, 2026-08-05

| # | missing | why it is the blocker it is |
|---|---|---|
| 1 | **a trigger he can reach without Manus** | the only genuine gap; everything else on the VPS already exists |
| 2 | **a signature the VPS can verify** | today **nothing** distinguishes a commit he approved from any commit on `main` |
| 3 | **automatic rollback on regression failure** | today the script reloads first, tests second, and merely *prints* the rollback command (`DEFECT-004`) |
| 4 | **the DB checkpoint inside the script** | today `mysqldump` lives in the ritual, i.e. in a human's memory, not in `deploy.sh` |

Pieces 3 and 4 matter more once nobody is watching: an unattended deploy has no human to read
a warning or remember a step. The fuller inventory — migration exclusion, pushed tags, a
two-sided audit, `deploy.sh` merged to `main` — is in Part 3.

## Sequence

| # | item | state |
|---|---|---|
| 1 | `DEFECT-001` | patch written, awaiting the Owner's GO |
| 2 | `DEFECT-003` — staging | Owner is fixing it himself |
| 3 | **this** — signed-ref deploy | **not started, not this week** |
| 4 | `DEFECT-004` — regression before reload | after 3 |

Design detail is in Part 3 above, including what already exists on the VPS (pull, build,
reload, save point, regression, rollback, `CONFIRM=YES`) versus what is missing (a trigger,
a verifiable signature, auto-rollback, a DB save point in the script, migration exclusion,
pushed tags, a two-sided audit, and `deploy.sh` merged to `main`).
