# Maintenance backlog — known-stale tests

Things that are **failing but understood**. A failure listed here is not permission to ignore the
suite; it is a promise that somebody looked, wrote down what they found, and left the fix as work
rather than as a deletion.

Nothing in this file blocked the Xiangxiang Archive enablement on 2026-08-01, and the reason is
recorded per item.

---

## M-1 — three Computer Operator inertness tests assert a folder that now legitimately exists

**Status:** open · **Opened:** 2026-08-01 · **Blocks:** nothing · **Severity:** low (test-only)

**Failing (3, `node --test` on `main` @ `0012b06`: 1564 pass / 3 fail):**

| Test | File |
|---|---|
| `a dry-run creates nothing on disk — not even the approved root` | `src/computer/computerSupervisor.test.js:56` |
| `*** the allowedPath folder was NOT created, and nothing here would create it ***` | `src/computer/phase1Inert.test.js:196` |
| `*** the approved test folder still does not exist ***` | `src/computer/phase3aInert.test.js:118` |

All three assert `Test-Path 'C:\Aroma\ComputerOperator-Test'` is **false**.

**Why they fail:** the folder exists. It was created **2026-07-31 15:30:39Z** as part of the
Owner-approved Computer Operator canary provisioning, in the `aroma-3b` repo, deliberately and
with its own ACL. It is currently empty (0 entries).

**So the tests are stale, not the system.** They were written while Phase 1 / Phase 3a were inert
and *nothing in the world* had provisioned the path, so "the folder does not exist" was a valid
proxy for "this code did not create it". Provisioning made that proxy false without making the
underlying claim false — the code under test still creates nothing.

**How this must NOT be fixed:** by deleting `C:\Aroma\ComputerOperator-Test`. That directory is
real canary state belonging to a separate, governed piece of work. Deleting live state so a test
goes green is not a fix; it is destroying the evidence the test was written to protect.

**The actual fix:** assert what the tests mean instead of what they happen to observe — each
should create its own temp root, point the code at it, and assert *that* root is untouched. Then
the assertion holds whether or not the production canary folder exists.

**Why it did not block the archive:** the archive's own gate is `node --test
src/lab/conversationArchive.test.js src/routes/demoRouter.test.js` — 44 pass, 0 fail. These three
concern the Computer Operator's filesystem inertness and share no code, no flag and no path with
the Lab.

**Owner decision needed:** none. This is ordinary test maintenance, to be picked up with the next
Computer Operator round.
