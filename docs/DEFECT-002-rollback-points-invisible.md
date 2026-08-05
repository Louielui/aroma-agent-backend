# DEFECT-002 — the Owner's own rollback points are invisible to him

**Repo: `aroma-system` (production, and the VPS working copy). NOT fixed — reported only.**
**Found: 2026-08-05, by reading `scripts/deploy.sh` and comparing local/remote tags.**
**Severity: it does not break anything today. It breaks the recovery, on the day it is needed.**

---

## One line

**`deploy.sh` creates each rollback point as a local git tag on the VPS and never pushes it,
so the answer to 「what do I roll back to?」 exists on exactly one machine — and not the one
the Owner is sitting at.**

## Measured

`scripts/deploy.sh` (on the unmerged branch `origin/fix/deploy-sh-branch-resolution`), normal
deploy path:

```bash
CURRENT_HEAD=$(git rev-parse HEAD)
SAFETY_TAG="safety/pre-deploy-$ENV-$TIMESTAMP"
git tag "$SAFETY_TAG"          # ← created locally on the VPS
git fetch origin               # ← fetch only; no push, and no --tags push anywhere
git checkout "$LOCAL_BRANCH"
git reset --hard "$RESOLVED_REF"
```

`git tag` with no `git push origin --tags` after it. Nothing in the 149 lines pushes a tag.

Consequence, measured from AromaBrain:

| | newest tag |
|---|---|
| local clone | `release/v1.0.1-drill` / `safety/pre-github-align-v0-20260704` — **2026-07-04** |
| **GitHub** (`git ls-remote --tags`) | **same. Nothing after 2026-07-04** |
| VPS | unknown from here — no SSH access |

Today is **2026-08-05**. Any deploy in the last month created a rollback point that is
visible nowhere except the VPS filesystem.

## Why it matters more than it looks

1. **Rollback mode depends on tags the same script created locally.** It works — as long as
   that machine and that `.git` directory are intact. The rollback point and the thing it
   protects against share a single point of failure.
2. **The Owner cannot audit his own ritual.** CLAUDE.md §2 requires a tagged rollback point
   before every deploy. From where he works, there is **no way to confirm one was taken** —
   the record is not merely elsewhere, it is unreachable.
3. **It gets worse the moment deploys are automated.** An unattended deploy would create a
   rollback point nobody can see, for a change nobody watched. See
   `AROMA-SYSTEM-WORKING-MODEL.md` Part 3.

## Suggested direction — NOT APPLIED

- `git push origin "$SAFETY_TAG"` immediately after creating it, and fail the deploy if the
  push fails — an unrecorded rollback point should stop the deploy, not be skipped past.
- Backfill is likely impossible: tags for past deploys exist only on the VPS, and only if
  that clone is intact.

## How to verify a fix

After the next deploy, from any machine:

```bash
git ls-remote --tags origin | grep safety/pre-deploy
```

Today that returns nothing.

---

## Partial compensation, found while planning the DEFECT-001 deploy

Landing a production change **through a merged pull request** rather than a direct push gives
the Owner **a Revert button visible from his own desk** — in the browser, on GitHub, without
VPS access.

It does not fix DEFECT-002. The `safety/pre-deploy-*` tag is still created locally on the VPS
and still never pushed, so the deploy-time rollback point remains invisible. But the PR route
means there is **at least one rollback path the Owner can see and operate himself**, which is
more than the tag offers today.

Two further mitigations, specific to a single deploy rather than to the defect:

```bash
git rev-parse HEAD          # BEFORE deploying — the SHA, written down, is the real safety net
git push origin --tags      # AFTER  deploying — makes that deploy's safety tag visible anywhere
```

**Recorded as compensation, not as a fix.** The defect is still open: nothing here makes tags
travel by default, and the next deploy that skips these two commands is invisible again.
