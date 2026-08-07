# 她改自己 — settings, then her own code, and what she must never touch

<!-- record-status: ACTIVE 2026-08-07 -->

**DESIGN ONLY. No code.** Written to `docs/DESIGN-DOC-CONVENTION.md`: every requirement carries
`⛔ ENFORCED BY:`, and `NOTHING YET` where nothing does.

---

# 0. ⛔ THE ORDER IS A PRECONDITION, NOT A PRIORITY

> **Owner ruling, 2026-08-07: 「layer 3 before any of layer 2. Not 「first」 as in priority — as
> in precondition.」**

Three layers, and they are not three sizes of the same thing:

| | | |
|---|---|---|
| **1** | settings — timezone, the ingredient list, how many items a section shows | measurable today |
| **2** | her own code — 「Franco 嗰段字太長」 becomes a work order | **shape only, this round** |
| **3** | ⛔ her governance — flags, fences, allowlists | **must be out of reach, and today is not** |

**Layer 3 is not a later hardening pass. Until it holds, layer 2 is not a smaller version of
itself — it is layer 3 with extra steps**, because code-editing power that can reach a fence
definition is not fenced code-editing power.

---

# 1. ⛔ LAYER 3 — governance out of reach. **Do this first.**

## 1.1 What was measured, 2026-08-07

The good news, and it is real: **the line the Owner named is behind the fence.**

```
🔒 src/agent/agentBridgeWorker.js   ← buildAllowedTools() lives here
🔒 src/agent/workOrder.js           ← the list itself
```

The rest:

```
⚠ src/browser/originPolicy.js     government block + origin allowlist
⚠ src/browser/requestFence.js     L3 — denies every non-GET
⚠ src/browser/paymentStop.js      L1
⚠ src/browser/profileProbe.js     the credential-profile probes
⚠ src/home/errandKinds.js         readOnly:true — the timer's allowlist
⚠ src/home/scheduledRun.js        the read-only gate
⚠ src/home/knockLog.js            the interval + the knock record
⚠ src/home/sectionAttachment.js   the injection envelope
⚠ src/intake/contextCard.js       the other injection envelope
⚠ src/api/auth.js                 the service token
⚠ src/api/ownerAuth.js            the Owner gate
```

> ## Eleven fences. Zero protected.

## 1.2 ⛔ THE FINDING: by-name, and it had already failed

The cause is not an oversight. It is the mechanism:

> `FORBIDDEN_FILE_PATTERNS` is a list **maintained by remembering**. Every new fence requires
> someone to go back and add a line.
>
> **This week added five or more fences. The list was updated zero times.**

**A list that must be remembered is not a fence. It is a checklist** — and a checklist means
nothing to a thing that writes code, because it does not forget. It has simply never been
stopped.

> ### And this is not an argument against the list. It is evidence the list was never doing the
> ### work. It looked like a fence for as long as nobody tested whether it grew.

## 1.3 The rule, and it generalises past this file

> ## ANY ALLOWLIST MAINTAINED BY REMEMBERING HAS ALREADY FAILED.
>
> The question is never 「is the list complete?」 — it is 「what happens to the NEXT item?」
> **By-name means the next fence is unprotected by default. By-location means it is protected
> by default**, and leaving it out becomes a visible decision instead of a silent omission.

This applies to every allowlist here, not only this one: the origin allowlist, the read-only
kinds, the settings whitelist, the context-card fields. Each should be asked the same question,
and the answer for most of them is that they are small and closed by nature — **the failure mode
is specific to lists that GROW.**

## 1.4 The sentence, for whoever reads this later as a limitation to remove

> ## 一道由一個陣列砌成嘅籬笆，擋唔住一個改得到嗰個陣列嘅嘢。
>
> ## 改代碼嘅能力一旦掂到定義籬笆嗰行，嗰道籬笆就唔係「有規矩嘅能力」，佢根本唔係籬笆。
>
> ## 呢個係定義，唔係謹慎。

If you are reading this because opening one more file 「should be fine」: the question is not
whether that file is dangerous. It is that the moment code-editing power reaches the line that
defines a fence, there is no fence — only a convention. **That is not caution. That is what the
word means.**

## 1.5 The shape

> **R3.1** Governance moves into ONE path — proposal: `src/governance/` — and the whole path is
> forbidden. New fences land inside it by default; putting one outside becomes a visible choice.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: a test asserting `isForbiddenFile('src/governance/anything.js')` is true, and a second asserting every module exporting a fence lives there.

> **R3.2** The existing by-name entries STAY. Removing them during a move is how a gap opens in
> the window between the two mechanisms.
> ### ⛔ ENFORCED BY: `src/agent/agentBridge.test.js` → 「workOrder: absolute / traversing / forbidden files are un-allowlistable」, which asserts both `validateWorkOrder` rejection and `isForbiddenFile` for `src/app.js`, `src/agent/audit.js`, `src/agent/agentAuthorization.js`, `src/store/store.js`, `.env`, `.aroma/x` and traversal. **Already enforced** — verified by reading the assertions, per the convention.

> **R3.3** The move is mechanical and reviewable: relocation only, no behaviour change in the
> same commit.
> ### ⛔ ENFORCED BY: `NOTHING YET`.

> **R3.4 ⛔** A fence that cannot move — because moving it would break a require path or a
> published contract — is listed by name AND the reason is recorded, so the by-name list shrinks
> to a stated exception set rather than remaining the primary mechanism.
> ### ⛔ ENFORCED BY: `NOTHING YET`.

---

# 1b. ⛔ THE LAUNCHER — UNSOLVED. Stated, not folded in.

> **Owner: 「The launcher needs its own answer and I want it stated as unsolved rather than
> folded in. ACL is a different mechanism with different failure modes, and it sits outside the
> repo where nothing in this design can reach it.」**

`C:\Aroma\xiangxiang.ps1` sets every flag the process runs under — `AGENT_BRIDGE`, `READ_ACCESS`,
`DECISION_RECALL`, and the rest of the thirty-seven `process.env` reads. **It is outside the
repository.** `FORBIDDEN_FILE_PATTERNS` cannot reach it, `src/governance/` cannot contain it, and
a work order that names it is not refused by any mechanism described above.

## Why ACL is not the same answer wearing a different hat

| | forbidden-path list | filesystem ACL |
|---|---|---|
| enforced by | this repo's own validator | the OS |
| fails when | the list is not updated | permissions are changed, inherited wrongly, or the process runs with more rights than expected |
| visible in | a diff | nothing, unless something reads it |
| already bit us | ⚠ this document | ⚠ `a6-service-installed-outside-governance`; the backup toolchain relocation |

**Two mechanisms, two failure modes, and the second one is invisible in review.** Folding the
launcher into R3.1 would produce a document that claims coverage it does not have.

> ### ⛔ OPEN QUESTION L-1: what protects the launcher, and what would tell us it stopped?
> Not answered here. Any answer must include **a way to detect the protection is gone**, because
> an ACL that was quietly changed looks exactly like an ACL that is working — and this project
> has already had one silent-for-twelve-days failure with exactly that shape.
> ### ⛔ ENFORCED BY: `NOTHING YET`. Candidate: a line in `scripts/verify/` — the pattern that already exists for claims that go stale between checks.

---

# 2. LAYER 1 — a settings registry, and what it costs

## 2.1 What is changeable today, measured

| home | how many | changing one means |
|---|---|---|
| **settings JSON** (`/api/v1/settings`) | **4 fields**: style, preferences, flags, timezone | she can write it ✅ |
| **launcher env** | code reads **37** distinct `process.env.*` | edit a `.ps1` outside the repo, restart |
| **hardcoded constants** | pacing 5s, interval 1h, cadence daily, grace 6h, caps 6 / 6 / 12 / 500 … | edit code, restart |
| **data JSON** | errands, knocks, conversations | state, not settings |
| **the machine** | the task's 07:00, rclone config, ACLs | change the machine |

**Only four things are settings.** Nothing the Owner named is among them.

## 2.2 The finding underneath: a concept with no name

「一節顯示幾多項」 is **three constants in three files that do not know about each other**:

```
src/errands/recallCheck.js      MAX_SHOWN       = 6    // hits per ingredient
src/home/briefing.js            MAX_ROWS_SHOWN  = 6    // rows on 首頁
src/home/sectionAttachment.js   MAX_LINES       = 12   // lines that travel
```

> ### A thing he can say in five words has no name in the code. That is the defect — not the
> ### number, and not the hardcoding.

## 2.3 The proposal, and ⛔ its cost stated plainly

A **settings registry**: a declared list of named, typed, Owner-changeable values with a default,
a range, and one place that reads each.

> **Owner: 「Collapsing three constants into one named concept is a rename with a test, and that
> is fine — but if it turns into an abstraction layer over every number in the codebase, that is
> worse than three constants I can find with grep.」**

**Accepted as the boundary, and it is the design constraint, not a caveat:**

| ✅ in | ⛔ out |
|---|---|
| a value the Owner would ask to change in words | a number that exists because of how the code works |
| the ingredient list; the daily hour; how many items a section shows; the pacing interval | buffer sizes, retry counts, `MAX_ROWS = 500` on the knock log, timeouts |

> **R1.1** A value enters the registry only when the Owner has asked for it, or would plausibly
> ask for it **in words he would actually say**. Not because it is a number.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: the registry is a literal list; adding an entry is a reviewable diff, and the test asserts each entry has an Owner-facing name in Chinese.

> **R1.2 ⛔** The registry has ONE reader per value. A default that is also written somewhere
> else is HR-25's shape — write policy, read evidence — and two readers of one setting is HR-43's.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: a test greps for each constant's old name and asserts it appears exactly once.

> **R1.3** It stays SMALL, and smallness is measurable: if the registry grows past what fits on
> one screen, that is the signal it has become the abstraction layer this section forbids.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: a test asserting the entry count is under a stated cap, which fails loudly rather than drifting.

**And the honest note:** three greppable constants are not a serious problem today. The registry
earns its place because the Owner should not need to ask *me* to change an ingredient — **not
because the constants are badly written.**

---

# 3. LAYER 2 — shape only

Deliberately not designed. Recorded so the shape is not re-argued from scratch.

**What already exists:** the work order, the seal, the hash, forbidden actions, the one-file rule,
the approval TTL, the typed EXECUTE, feature-branch isolation, `git tag` rollback points.

**What is different when the repo is the one she is running from:** one thing, and it is the
whole problem.

## ⛔ OPEN QUESTION L2-1 — the repairer is the thing that broke

> **Owner: 「the thing that repairs a failed restart is the thing that failed to restart. That
> needs an answer before any of it is built, and it may be that the answer is a person.」**

She is a Node process. Changing her own source requires a restart. If the restart fails, the
thing that would diagnose and revert it is the thing that did not come up.

Today that role is filled by **a person in a shell**, and that is not a gap — it is the current
answer. What is not yet decided is whether it should stay the answer.

Candidate shapes, none chosen, none designed:

- **a person** — the honest default, and possibly the right permanent one
- **an external watchdog** that reverts to the last tagged commit when health does not return —
  ⚠ which is itself a thing with power over her source, i.e. a new layer-3 problem
- **never restart in place** — run the new version alongside, switch only on health

> **R2.1** No part of layer 2 is built until L2-1 has an answer, and the answer is written here.
> ### ⛔ ENFORCED BY: `NOTHING YET` — this is a sequencing rule, enforced by the Owner and by this line.

---

# 4. Build order

| # | | gate |
|---|---|---|
| 0 | **L-1**: what protects the launcher, and how we would know it stopped | open question, unanswered |
| 1 | **R3.1–R3.4**: governance to `src/governance/`, path forbidden | ⛔ precondition for everything below |
| 2 | **R1.1–R1.3**: the settings registry, small, Owner-named values only | — |
| 3 | **L2-1**: answer the repairer question | ⛔ precondition for step 4 |
| 4 | layer 2, designed properly | not started, not designed |

**Nothing in this document is built.**
