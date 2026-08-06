# She reads the development record

**DESIGN ONLY. No code.** 2026-08-06.

> **Owner:** 「Right now everything decided tonight lives in Claude Code's session and in
> `docs/`. She knows none of it. If I ask her tomorrow why DEFECT-001 was not fixed, she
> cannot answer. That is the gap that stops her participating in development. Not workers —
> she already dispatches to Claude Code. Not reasoning — she is Claude. **Memory.**」

---

# 4. FIRST — is this a new source? NO. And two of my assumptions were wrong

**Measured, because the answer changes the whole design.**

## The GitHub connector is LIVE, and already pointed at exactly the right repo

| | measured |
|---|---|
| `CONTEXT_GITHUB` | **`'on'`** in the launcher |
| `GITHUB_READ_TOKEN` | **set** in `.env` (93 chars) |
| `GITHUB_READ_REPO` | **`Louielui/aroma-agent-backend`** — **her own repo, where `docs/` lives** |
| `listPullRequests` live call | **25 results** |
| `listCommits` live call | **8 results**, newest body **3,176 chars** |
| `getFileAtRef('docs/HOUSE-RULES.md')` | **OK — 18,792 chars returned** |

**A standing memory note says 「GitHub OFF pending a read-only PAT」. That note is stale** and
should be corrected: the PAT exists and the connector answers.

## What she can and cannot see through it TODAY

`githubRead.js` exposes five methods: `listPullRequests`, `getPullRequest`, `listBranches`,
`listCommits`, **`getFileAtRef`**.

But `readContext.planFor('github')` builds only one plan:

```js
method: 'listPullRequests', fallback: { method: 'listCommits' }
```

> ## `getFileAtRef` EXISTS on the adapter and is UNREACHABLE from the read layer.
> **The capability to read a doc file is already there. Nothing routes to it.**

So today she can see **PR titles and bodies, and commit messages** — and this week's commit
messages are, in prose, most of the record: causes, refutations, measurements, the reasoning
for each ruling. **She is already closer to this than expected.** What she cannot see is any
file: not `HOUSE-RULES.md`, not a DEFECT file, not this document.

> ### Verdict: an EXTENSION of a live connector, not a sixth source.
> One method reachable, plus a plan that knows when to use it. **No new scope, no new
> credential, no new adapter.**

---

# 1. WHAT IS THE RECORD, AND WHAT IS A WORKING NOTE

42 markdown files. **She must not treat a scratch file as a ruling**, so the classification
has to be a property of the file, not a judgement she makes at read time.

## THE RECORD — durable, and she may cite it

| file | what it is |
|---|---|
| `HOUSE-RULES.md` | **HR-1 … HR-13.** The rules themselves |
| `DEFECT-001 … 006` | measured defects, their causes, and their disproofs |
| `GOVERNANCE-BROWSER-VS-FILE.md` | 「forbiddenActions 由機制退化成意向」 and the standing rule |
| `DESIGN-IDENTITY-DIMENSION.md` | the three identity cases, and which one is carried |
| `DESIGN-WORKER-ADAPTER.md` | the fence contract and its entry rule |
| `AROMA-SYSTEM-WORKING-MODEL.md` | the standing property: **AromaBrain cannot deploy** |
| `PRODUCT-IA.md` | the map, the six items, the growth rule |
| `PROPOSAL-CANCELLATIONS.md` | why specific proposals were cancelled |
| `docs/governance/AISL-*` | the governance baseline |

## WORKING NOTES — real, but not rulings

| file | why it is not a ruling |
|---|---|
| `PLAN-DEFECT-001-FIX.md` | **a plan for a fix that was never applied, for a cause that was disproven** |
| `RESTOCK-LIST-MEASUREMENTS.md` | measurements, true on the day, and stock moves |
| `PERMISSIONS-AUDIT-AROMA-SYSTEM.md` | a snapshot mid-pruning; the counts changed four times |
| `LANGUAGE-POLICY-ROUND2-AUDIT.md` | an audit whose rewrites were never carried out |
| `B2-1*-completion-report.md`, `TURN-ROUTER-MIGRATION.md` | historical, superseded |
| `MAINTENANCE-BACKLOG.md` | intentions, not decisions |
| `docs/lab/**`, `docs/canary/**` | experiments |

## ⚠ The hard case, and it is the reason this section exists

**`PLAN-DEFECT-001-FIX.md` is a complete, confident, well-argued plan for a fix that must
never be applied.** Its cause was disproven hours later. A reader who found it and stopped
would rebuild exactly the wrong thing.

**And `DEFECT-001` itself is BOTH**: a record of a real measurement *and* a record of three
wrong conclusions, with a banner at the top saying so.

> ### So the classification cannot be per-FILE alone. A file can contain a superseded ruling.

**The mechanism this needs is a status the document declares about itself** — `ACTIVE`,
`SUPERSEDED`, `DISPROVEN`, `WORKING NOTE` — in a fixed place, machine-readable, at the top.
Several documents already carry this in prose (`⛔ DISPROVEN`, `❌ SUPERSEDED`), which is the
right instinct without the structure.

**Without it, correctness depends on her reading far enough to find the banner** — and a
retrieval system that returns an excerpt may return the confident middle rather than the
qualifying top. That is `count: 43` in a document.

---

# 2. RETRIEVAL OR SUMMARISATION? — MEASURED, AND IT IS BOTH, IN THIS ORDER

**Do not assume. The numbers decide it.**

| | measured |
|---|---|
| `docs/**.md` | **42 files, ~410,000 characters** |
| her ENTIRE context block, ALL five sources | **`maxTotalChars: 6000`** |
| items kept per source | **`maxItemsPerSource: 4`** |
| `HOUSE-RULES.md` alone | **19,130 chars — 3× the whole budget** |
| `DEFECT-001` alone | 20,763 chars |

## What each approach fails at, separately

**Pure retrieval fails on size.** Fetching the *correct* file still overruns the budget by
3×. `getFileAtRef` returning `HOUSE-RULES.md` gives her 18,792 characters for a 6,000-char
block shared with Drive, Gmail, Calendar and aroma_system. It would be truncated by the
provider — and a truncated rules file is a rules file missing its later rules, silently.

**Pure summarisation fails on fidelity.** 410,000 → 6,000 is **68:1 across 42 documents**.
That can answer 「what topics exist」. It cannot answer 「why was DEFECT-001 not fixed」, which
needs a specific chain: three causes, each disproven, by which measurement.

## The shape the numbers actually point at

> ### It is a RETRIEVAL problem between documents, and a SELECTION problem inside one.

And a third fact makes it tractable: **the decided content is a small fraction of the prose.**
`HOUSE-RULES.md` is 19k characters carrying **thirteen rules**. The reasoning is for a human
who wants to be convinced; she needs the ruling and a pointer to the argument.

**So the record she reads should not be the documents themselves.** It should be a derived
index — one entry per ruling/defect/decision: the statement, its status, its date, and the
file and heading it came from. A few hundred characters each, so four of them fit a source
budget, and the full document is one deliberate follow-up read away.

**Generated, never hand-maintained.** A hand-written index goes stale exactly like the
memory note in §4 did, and a stale index of rulings is worse than none — it is HR-13's
family: something that reports what it holds and cannot report what it missed.

---

# 3. WHAT SHE MUST NEVER DO WITH IT

> ## A decision written down is HISTORY, not PERMISSION.

This is `recall-is-not-evidence` applied one layer up, and it is the same failure with a more
convincing costume: a document is *durable*, *specific* and *authoritative-looking*, and it
still says only what was true when it was written.

| she must never | because |
|---|---|
| treat 「approved」 in a document as authorisation now | it records a past approval of a past thing. **The only live authorisations are sealed orders with an unconsumed nonce** — everything else is a story about one |
| let a document justify an action | the record informs; the gate authorises. **A doc that says 「the Owner approved removing the fallback」 does not remove the fallback** |
| cite a plan as a decision | `PLAN-DEFECT-001-FIX.md` is a complete plan for a fix that must not be applied |
| present a superseded ruling as current | 「show nothing when nothing is waiting」 was a ruling for six hours, then reversed. Both are in the record |
| let the record inform ROUTING | the same rule that keeps recall out of routing. **What she reads must not decide what she reads next**, or the record starts steering the reads that would correct it |
| infer that a recorded intention was carried out | `LANGUAGE-POLICY-ROUND2-AUDIT.md` describes rewrites **that never happened** |

## And the one that is easiest to get wrong

**A defect being recorded does not mean it is fixed. A defect being fixed does not mean the
document says so.** `DEFECT-001` is disproven, `DEFECT-002/003/004/005/006` are open and
untouched, and the only way to know which is which is a status the document states —
**not the tense of its prose.**

**So every citation from the record must carry the status and the date**, in the same
sentence as the claim. 「HR-6 講……」 is incomplete; 「HR-6(2026-08-05,現行)講……」 is a
citation. Without the stamp she is quoting a document at an unspecified moment in its life,
which is exactly the failure this whole record exists to prevent.

---

# What this design is NOT

Not a new read source. Not a new scope. Not a memory system — **the record already exists and
is already durable in git**; what is missing is a route from it into her context, and a
classification that stops a scratch file from reading as a ruling.

**Nothing here is built. No code was written.**
