# DEFECT-003 — `staging → approve → prod` has no working staging

**Repo: `aroma-system` (production). NOT fixed — reported only.**
**Found: 2026-08-05, by comparing `origin/staging` to `origin/main`.**
**Severity: the ritual's review step exists on paper and not in the branch graph.**

---

## One line

**`origin/staging` is 18 commits behind `origin/main` and has contributed nothing back, so
deploying to staging today would put the site *backwards* rather than showing what is about
to ship.**

## Measured

```
origin/staging  621838f  "docs: add SYSTEM_MANIFEST"   2026-07-04
origin/main     58ac792                                 2026-07-06

commits main has that staging lacks : 18
commits staging has that main lacks : 0
```

`origin/staging` points at the same commit as the tag `baseline/v1.0.0-20260704`. It is not
a divergent line of work — **it is a month-old snapshot that stopped being updated.**

## Why it matters

CLAUDE.md §2 states the release path as **staging → approve → prod**, one page or feature at
a time. `deploy.sh` implements both halves faithfully:

```bash
APP_DIR="/home/ubuntu/aroma-app/aroma-staging"   PM2_PROC="aroma-staging"   LOCAL_BRANCH="staging"
```

So the mechanism is there and the environment is there. **What is missing is the habit of
moving the branch.** With `staging` frozen at the July baseline:

- `./deploy.sh staging origin/staging` would deploy a month-old system;
- there is **no ref** that means "what is about to go to production" — a reviewer has nothing
  to look at;
- the approve step in the ritual therefore has no artefact behind it, and 「approved on
  staging」 would be a statement about something that was never staged.

This is the same defect class as the two before it: **a step that reads as performed because
the machinery for it exists.**

## Suggested direction — NOT APPLIED

Two shapes, and the choice is the Owner's:

1. **`staging` tracks what is next**: fast-forward it to `main` when a change is ready to
   review, deploy it, review, then promote. Requires the branch to be moved every cycle —
   which is the habit that lapsed.
2. **Drop the branch and stage a ref**: deploy staging directly from the feature branch or
   the candidate tag, and let `staging` stop existing rather than exist while stale. A branch
   that is wrong is worse than one that is absent — an absent one cannot be deployed by
   mistake.

## How to verify a fix

```bash
git rev-list --count origin/staging..origin/main
```

Today that is **18**. Under option 1 it should be 0 at the moment of review. Under option 2
the branch should not resolve at all.
