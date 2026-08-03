# Maintenance backlog — known-stale tests

Things that are **failing but understood**. A failure listed here is not permission to ignore the
suite; it is a promise that somebody looked, wrote down what they found, and left the fix as work
rather than as a deletion.

Nothing in this file blocked the Xiangxiang Archive enablement on 2026-08-01, and the reason is
recorded per item.

---

## M-2 — re-evaluate encrypted off-site backup for the Xiangxiang archive

**Status:** scheduled · **Opened:** 2026-08-02 · **Re-evaluate on: 2026-11-02** · **Blocks:** nothing

**Owner decision, 2026-08-02:** off-site backup of the conversation archive is **deliberately not
done**. Uploading it would publish the Owner's conversations — and any third-party content still
in them — to an outside company. He has instead **accepted the residual risk**:

- D: is removable media, and NTFS permissions do not travel with the disk; offline or
  administrator access on another machine reads it;
- fire, theft and hardware failure hit both copies, because both are in one place.

**Mitigations in force:** D: does not leave the controlled location · the archive backup directory
re-verifies its own ACL on every run · nothing goes to B2 or any other cloud.

**On 2026-11-02**, with roughly three months of real conversations accumulated, decide whether
encrypted off-site backup is then worth its cost — principally a key that can be lost, which
turns a backup into nothing at all.

This is a **decision with a review date, not an omission.** Do not "fix" it by enabling a cloud
sync; that would reverse an Owner decision without asking him.

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

---

## Gmail keyword search misses English mailboxes (read logic, NOT presentation)

**Recorded 2026-08-03. Owner decision: note it, do not fix this round.**

**The measurement.** For 「最近有咩發票？」 the Gmail plan issues
`("發票") newer_than:90d` and returns **zero** messages. The invoice report email the Owner
expected to see does exist and was retrieved — but only through the recent-items FALLBACK
(`newer_than:7d`), i.e. because it was recent, not because it matched. Its subject and body
are English; the query term is Chinese.

**Why it matters.** The Owner asks in Cantonese; the mailbox is largely English. Every
Chinese-only search term therefore has the same failure mode: a genuinely relevant message
is unreachable by search and can only appear by accident, through a fallback that the
presentation layer is now required to exclude from the main result. The two rules combine
into a silent miss: correct behaviour at each step, nothing found overall.

**What this is NOT.** Not a presentation defect. The renderer is right to hide fallback
items — they were not selected for relevance. The gap is upstream, in how the query is built.

**Sketch of a fix (not approved, not designed).** Extend the term extractor so a CJK term
carries its common English equivalents into the query for latin-language sources
(發票→invoice, 供應商→supplier, 訂單→purchase order …), OR issue the source's own query in
both languages and merge. Either changes `planFor`/`extractKeywords`, i.e. read logic, and
needs its own GO and its own measurement — a wider query also costs relevance.

**Related, same round:** the Gmail adapter fetches `format:'metadata'` + snippet only, so an
aggregate figure that lives further down a report body is not retrievable at all. Reading
the body is a separate GO with its own privacy weight.
