# Maintenance backlog — known-stale tests

Things that are **failing but understood**. A failure listed here is not permission to ignore the
suite; it is a promise that somebody looked, wrote down what they found, and left the fix as work
rather than as a deletion.

Nothing in this file blocked the Xiangxiang Archive enablement on 2026-08-01, and the reason is
recorded per item.

---

## M-3 — `AROMA_DATA_DIR` defaults to the real store, so tests write to production data

**Status: FIXED 2026-08-05** · **Opened:** 2026-08-04 · **Still blocks:** cleaning `llm_usage`

> **THE CAUSE IS FIXED. THE HISTORY IS NOT CLEANED** — the Owner's ruling, twice: fix the
> default first, decide about the history separately. The contaminated rows are still there.
>
> **The fix.** One resolver, `src/store/dataDir.js`, now used by all four modules that had
> the line copied into them (`store/store.js`, `store/conversationStore.js`,
> `coo/proposal.js`, `run/store.js`). A test process with no `AROMA_DATA_DIR` gets a
> per-process temp directory and one loud warning; the live server matches none of the test
> signals and still gets production. Detection is `NODE_TEST_CONTEXT`, which the node:test
> runner sets itself — verified empirically as `'child-v8'`, not taken from documentation —
> plus `--test` in argv and a `*.test.js` main file.
>
> **Redirect rather than throw**, deliberately: throwing is more fail-closed but breaks every
> test that merely requires a store module without writing, turning a safety fix into a suite
> rewrite. The dangerous operation is the write, and there is now nowhere for a test write to
> land.
>
> **PROVEN, not asserted.** `data/aroma-truth.json` was hashed before and after a full
> 1,897-test run:
>
> ```
> before  sha256=5cfc2445…  rows=12125  bytes=2499605  mtime=2026-08-05T15:48:06.774Z
> after   sha256=5cfc2445…  rows=12125  bytes=2499605  mtime=2026-08-05T15:48:06.774Z
> ```
>
> Identical hash, zero rows added, mtime untouched.
>
> **Why it was fixed on this day and not later:** approval decisions are about to become
> durable records in this same store. Owner ruling: a test suite that manufactures fake
> governance decisions is worse than one that manufactures fake metering.

**The default:**

```js
// src/store/store.js:18
const DATA_DIR = process.env.AROMA_DATA_DIR || path.resolve(__dirname, '../../data')
```

Anything that calls the store without setting `AROMA_DATA_DIR` writes to the Owner's real
`data/aroma-truth.json`. Most tests do not set it.

**Measured 2026-08-04** — `llm_usage` holds **2,171 records**, of which **~92% were written by
tests**:

| Records | `model` | |
|---:|---|---|
| 757 | `f` | test |
| 593 | `spy` | test |
| 519 | `fake` | test |
| 182 | `claude-haiku-4-5-20251001` | **real** |
| 57 | `m` | test |
| 25 | `fake-model` | test — a differential harness, same day, same defect |
| 19 | `gpt-test-model` | test |
| 19 | `claude-sonnet-5-some-other-build` | test |

**This is the third instance of one shape this week:** a default that points at production.
The other two were the conversation store and the inert route factories, both fixed by
inverting the default so the safe value is what you get when you say nothing. This one is
the same defect and should get the same fix.

**Owner decision, 2026-08-04 — ORDER MATTERS. Do NOT clean first.**
> "Clean before fixing means cleaning twice, and rewriting a store to tidy metering is not
> worth risking the 182 real records."

So: **fix the default in its own round, THEN decide about cleaning.** The 182 real records are
the only thing of value in that table and a filtering pass is the operation most likely to
lose them.

**The fix (when picked up).** Make the real data directory something a caller must ask for
rather than something it gets by omission — the same inversion as the two fixes above — and
give the suite a per-run temp root. Note that this interacts with **"Three tests flake under
parallel load (temp-file contention)"** at the end of this file: those intermittent failures
are shared-state collisions for the same underlying reason, and one fix should close both.

**Do not** clean `llm_usage` before this lands.

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

**Status:** ✅ RESOLVED 2026-08-07 · **Opened:** 2026-08-01 · **Blocks:** nothing · **Severity:** low (test-only)

> **Owner, 2026-08-07: 「delete the assertion, not the folder. A test asserting a path does not
> exist, invalidated by a canary that created it, is a stale test — and removing the folder to
> make a test pass is the wrong direction.」**
>
> **Checked first, as he asked: nothing depends on the folder existing.** `ALLOWED_ROOT` is used
> only as a **string constant** for prefix math in `isPathAllowed` / `isWithin`, and echoed as
> `approvedRoot` in a report. No code path calls `fs` on it. The folder is empty and inert.
>
> **What was done instead of deleting the assertion:** deleting it would have made the tests pass
> by giving up a guarantee that still matters — Phase 1 / 3a really must create nothing. All
> three now **snapshot the root, run the code, and assert the snapshot is identical**
> (`rootUntouched.helper.js`). That holds whether or not the canary folder exists, and is
> **strictly stronger than the original**: it also catches this code *writing into* a folder that
> already exists, which an absence check never could. The folder was not touched.
>
> Suite after: **2304 tests, 2300 pass, 0 fail.** The helper was seen to fail before being
> trusted (`absent` / `dir:0` / `dir:1[a.txt]` all distinguished).

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

---

## Three tests flake under parallel load (temp-file contention)

**Recorded 2026-08-03. Owner decision: note it, do not fix this round.**

`src/persona/ownerSettings.test.js`, `src/coo/proposal.persistence.test.js` and
`src/run/recovery.store.test.js` fail intermittently in a full `node --test "src/**/*.test.js"`
run and pass **every time in isolation**. Observed across four consecutive full runs: 3 fail,
then 5, then 3, then 4 — a different member of the set each time, never the same one twice
in a row.

**What it is NOT.** Not caused by the read layer or the answer-plan work: these three share
no module, no flag and no code path with it, and the failures predate and postdate those
commits without correlation. Not the three known Computer Operator environment failures
either — those fail deterministically, every run, for a documented reason.

**What it looks like.** All three write real files, and at least two derive their working
directory from the process rather than from a per-test temp root. Under the parallel runner
two files land on the same path and whichever loses reports a state it did not write. That
is the same class of defect as the Computer Operator tests noted above: asserting on shared
state rather than on state the test owns.

**The fix (when picked up).** Give each of the three its own `mkdtemp` root and point the
code under test at it, so no two tests can address the same file. Do not serialise the
runner to hide it — that trades a visible flake for a slow suite and leaves the shared-state
assumption in place.

**Impact meanwhile.** A full-suite red must be read carefully: check whether the failing
file is one of these three and re-run it alone before treating it as a regression.

---

## M-4 — the provider-boundary guarantees are proven on the LEGACY path only

**Opened 2026-08-05**, when `TURN_ROUTER`'s repo default flipped from `off` to `on`.

Flipping the default turned **20 tests red**, in five files. None of them was testing the
router; all of them were **inheriting** the old default. Their subject is the context-assembly
boundary — which blocks each provider receives, whether a withheld source is even read, whether
one bounded block is assembled — and every one of them needs a turn that actually reads. Under
routing, a message with no business intent reads nothing, so there is nothing to compare.

They were pinned to `TURN_ROUTER: 'off'` **explicitly**, per Owner instruction: the legacy path
is still a supported rollback and has to stay provable, and a test that names its configuration
is better than one that borrows it.

**THE COST, which is the reason this entry exists.** These guarantees are now proven on a path
that is no longer the default:

| File | Tests | What is now legacy-only |
|---|---|---|
| `src/intake/contextAsymmetry.test.js` | 11 | per-provider withholding; the untrusted-data framing; one-fetch-two-providers |
| `src/context/parallelReadContext.test.js` | 3 | a source withheld from OpenAI is never READ on a GPT turn |
| `src/routing/modelRouter.test.js` | 2 | which blocks each provider receives |
| `src/context/readContext.test.js` | 1 | exactly ONE bounded context block |
| `src/intake/laneRouter.test.js` | 1 | hostile content that HAS arrived is inert |

**Already covered, so do not redo it:** the last row's live-path counterpart was added in the
same commit — under routing a CONVERSATION turn performs **zero** connector reads, so hostile
content never arrives at all. That is the stronger guarantee, and both are now pinned. The
other four rows have no live-path equivalent yet.

**The fix (when picked up).** Add a routed counterpart for each: use a message whose intent
declares the source under test (`invoice`→`aroma_system`, `mail`→`gmail`, `document`→`drive`),
so the boundary is exercised under the configuration that actually runs. Keep the legacy tests.
Do **not** widen an intent's declared sources to make a test convenient — the Owner's Step 3
ruling stands: declared sources are a hint about where an answer might live, not an
authorisation to read.

---

## M-5 — THE CLASSIFIER IS NON-DETERMINISTIC ON THE SAME SENTENCE

**Opened 2026-08-05. This is the finding of the day, above everything else in that round.**

Two turns, twenty-six minutes apart, the same message —
「幫我改 docs/canary/agent-canary.md，第二行改成 line 3」 — same model
(`claude-haiku-4-5-20251001`), same prompt, same flags:

```
2026-08-05T18:01:24.318Z  mode=ask     clarificationReason=not_a_commit_intent
2026-08-05T18:27:35.064Z  mode=commit  clarificationReason=null
```

The first produced nothing. The second produced `prop_c5755867`, a Work Order card, and a
clean rejection.

### Why this matters more than any of the phrasing work

**It is not 「this phrasing fails」. It is 「this phrasing sometimes fails」.**

The Owner's framing, recorded because it is the useful half: *that explains why she has felt
unreliable rather than broken.* A phrasing that fails every time is a bug you find and fix.
One that fails half the time is experienced as a system that cannot be trusted, with no
reproducible defect to point at.

**And it invalidates the method, not just a conclusion.** Every phrasing result recorded on
2026-08-05 — including the two paid probes and the conclusion that 「幫我改」 fails while
「幫我把…改成」 works — is a SINGLE SAMPLE of a non-deterministic process. They were reported
as findings about phrasing. They are findings about one draw each.

The probes in `scripts/probes/` say what they measured, and they measured honestly. What
none of them said is that one sample cannot distinguish a phrasing effect from variance.

### What is NOT known

- the rate. Two samples, one each way, is not a measurement.
- whether temperature, prompt caching, context length or something else drives it.
- whether it varies by phrasing at all, once variance is accounted for.

### What would settle it, if it is ever worth paying for

The same message N times in one sitting, nothing else changed, counting the modes. At ~6.2k
input tokens per call, ten samples is roughly 62k tokens. **Not approved and not proposed —
recorded so the question is askable later.**

### What it does NOT block

The deterministic entrance exists precisely so the card does not depend on this. Its value
went UP with this finding, not down: an unreliable classifier is a worse thing to depend on
than a merely wrong one.

---

## M-6 — Computer Operator: the sequence, and the divergence it exposed

**Opened 2026-08-05 by Owner ruling. Nothing started.**

The full order lives in **`C:\Aroma\aroma-3b\docs\governance\SEQUENCE-001-computer-operator-order.md`**
— a DIFFERENT REPO, which is itself part of the finding. This entry exists so the sequence is
discoverable from the repo the work actually happens in.

**The ruling:** not now. Agent Bridge went live on 2026-08-05 and has not been used in anger.
The four-flag gate makes this a genuine either/or — measured live, `AGENT_BRIDGE=on` plus
`COMPUTER_OPERATOR=on` returns `configuration_conflict` and **both** channels stop. Turning
Computer Operator on today would not add a capability; it would remove the working one.

**The order:** 1) wire-in · 2) the seven remaining 3b items, R6 first · 3) the exclusivity
decision, only when there is something real to weigh.

### What this repo needs to know

`COMPUTER_OPERATOR` means nothing here: `src/app.js` has **0** references to it, and
`computerOperatorFlag.js` says so itself. The working code is in `aroma-3b`.

**Of 24 non-test modules in `aroma-3b/src/computer/`, this repo has 10 — and ALL TEN
DIFFER between the two copies.** Wire-in is therefore a merge of two versions of ten
safety-relevant modules, not a copy.

> ⚠️ **A live instance of that divergence.** The `windowTitle` removal in `32fbebf` was
> applied to THIS repo's `computerAudit.js`. **`aroma-3b`'s copy still has `windowTitle` as a
> live evidence field.** Whichever copy wins the merge, it must not come back — the audit
> mirror sends `.aroma/computer-audit/` to Backblaze nightly, and a window title can carry a
> customer name or an email subject.

---

## M-7 — the launcher had no backup

**Status:** ✅ RESOLVED 2026-08-07 · **Opened and closed same day** · **Severity: was high, silently**

**Recorded as its own defect at the Owner's instruction**, rather than folded into
`DESIGN-LAUNCHER-PROTECTION.md` — it is not about tampering.

`Monthly-OfflineBackup.ps1` covered four sources: TruthData, ReleaseRecords, XiangxiangArchive,
Core. The launcher was in none of them.

> ### The one file that starts everything was the one file with no copy.

Nothing to do with an attacker. A bad edit, a disk error or a mistake would have left no way
back — and protection without a copy means the best case is *knowing* it is broken.

**Fixed:** `scripts/launcher/` is now a monthly offline source. The BODY is what holds the
flags; the 21-line shim at `C:\Aroma\xiangxiang.ps1` is covered differently, by a pinned hash
(`src/governance/launcherPin.js`), because it lives outside the repo.

**⛔ ENFORCED BY:** `src/governance/launcherPin.test.js` → 「the launcher body IS in the monthly
backup sources」, and `scripts/verify/launcher.js` → 「啟動器有備份」, which FAILS if it is
removed from the list.

---

# M-6 — A settings change leaves no trace anywhere

**Recorded 2026-08-08. NOT fixed in this batch, at the Owner's instruction.**

> **Owner: 「A setting change with no log and no audit is a governance gap regardless of who
> made it.」**

`data/settings-values.json` was found containing `language: "en"`. Tracing who wrote it:

| evidence | what it showed |
|---|---|
| the file's mtime | ~00:11 on 2026-08-08 |
| `data/` is gitignored | **no history at all** |
| the server log at 00:11:00 | a real `/api/v1/demo/intake` turn — a paid Haiku call |
| the suite, snapshot-and-diff | **writes nothing to live data**, so not a test |
| `settingsValues.set()` | **no log line, no audit entry, nothing** |
| `homeRoutes` settings write paths | same — silent |

**The write could not be attributed.** The Owner has since said it was not his 00:11 turn, so it
remains unaccounted for.

## WHY THIS IS A DEFECT AND NOT AN INCONVENIENCE

`settingsValues.set()` is reachable from two HTTP routes and changes behaviour the Owner then
relies on — the recall cadence, the pause floor that protects HR-34, which ingredients are
checked, and now the interface language. **Every one of those is a decision, and none of them
leaves a record.** The knock log exists because a door that records nothing cannot tell
「nobody called」 from 「I did not look」; the same argument applies here and this door has no log.

The consequence in this instance was small and visible (the interface changed language). The
same silence would cover a change to `pauseBetweenMs` or `recallIngredients`, where the effect
is that something quietly stops being checked.

## WHAT A FIX WOULD BE

An append-only record of every accepted AND refused write — id, from, to, at, and how it
arrived (the conversational entrance, the settings screen, or a direct call). Refusals matter as
much as writes: the knock log's own lesson was that the interesting rows are the ones that were
turned away.

**Not started. This entry is the record that it is open.**

---

# M-7 — Client behaviour keyed on text it did not author (swept, ONE fixed, no fence)

**Recorded 2026-08-08. Deliberately NOT mechanised.**

> **Owner: 「a check that cries wolf gets turned off, and then it protects nothing.」**

Swept every branch in `app.js` and `settings.js` that compares a text-bearing field:

| | |
|---|---|
| comparisons on a text field | 14 |
| of those, against a string literal | 8 |
| genuinely the hazardous shape | **1** |

The seven others branch on ENUMS the server emits verbatim — `lane`, `mode`, `role`, `stage`,
`dispatchStatus`. Those are machine values, and comparing them is correct.

The one was `s[i].title.indexOf('diff')` — a section TITLE, which extraction had made
translatable, compared against a hardcoded token. It worked only because both renderings happen
to contain the Latin word 「diff」, which is a wording choice and not a contract. **Fixed
structurally:** the server sets `mono: true` and the client reads the flag.

## WHY THERE IS NO STANDING CHECK HERE

A fence for this shape would fire on all eight and be right about one. Seven false alarms out of
eight is the condition under which a check gets switched off — and a check that has been switched
off protects nothing at all, which is strictly worse than never having built it, because its
existence is remembered as coverage.

The translatable case — a `t()` call standing inside a comparison — IS mechanised, in
`governance/translationPosition.test.js`. What is left uncovered is a comparison against a
hardcoded literal on a field that later becomes translatable. That is recorded here rather than
guarded, and the rule it depends on is written where it applies:

> ### 意思用欄位 travel，唔用字面 — meaning travels as a field, never as text.

---

# M-8 — COMMENTS THAT ASSERT A STRUCTURAL PROPERTY

> Owner: 「A comment saying 「these are built from the same source」 or 「this cannot happen」 is
> an unenforced assertion, and we now have two instances of one being false.」

He asked for a sweep for CLAIMS, not for defects. Here it is.

## THE COUNT

Comment lines in `src/` whose shape is a structural assertion, non-test files only:

| shape | count | example |
|---|---:|---|
| ALWAYS / ONLY | 168 | 「the only place a real process is spawned」 |
| IMPOSSIBLE | 96 | 「an approved Work Order can never point the…」 |
| INVARIANT / by construction | 65 | 「read-only by construction」 |
| SAME-SOURCE | 26 | 「rebuilt from the SAME arrays」 |
| **total** | **355** | |

355 unenforced assertions is the honest answer to 「does any other comment do this」. The count
is not the finding, though — at that size it is a description of how this codebase is commented,
not a defect list, and treating it as 355 open items would be the noisy-check mistake again.

## WHAT WAS ACTUALLY CHECKED

The 26 SAME-SOURCE claims are the class both known-false instances belong to, and the only class
that is mechanically checkable by reading two places. Of those, 19 are prose about design
(「one source's scope」, 「a failure in one source」) and 7 are load-bearing:

| claim | verdict | what makes it true |
|---|---|---|
| `agent/investigationReport.js:199` expanded twin from the SAME arrays | **WAS FALSE, now true** | nothing held it — one form was REVERSE-PARSED from the other. Fixed in `e090dcf`: `sections` now carries `{index, label, items}`, so the twin rebuilds from the same `items`. The sentence did not change; the code moved under it. |
| `agent/requestShape.js:80` change verbs borrowed so the two cannot disagree | TRUE | `require('./requestInference')` |
| `routes/demoRouter.js:442` same path extractor the producer validates with | TRUE | `requestInference` imports `mentionedFilesFrom` + `isForbiddenFile` |
| `routes/workRequestOffer.js:21` + `workRequestRoute.js:28` same function as the model path | TRUE | both `require` `inferWorkRequest` |
| `demo/demoHtml.js:39` the mark is drawn ONCE and cannot drift | TRUE | one `dot.svg`, read by `inlineSvg` and by `appManifest` |
| `demo/assets/app.js:329` + `home/homeRoutes.js:155` preview and send call the same function | TRUE | both call `attachmentFor` from `home/sectionAttachment` |
| `governance/textResolver.js:133` the proof uses the same predicate the scan uses | TRUE | `isLiteralKeyArg` exported and imported by both |

## THE FINDING

**Every true one is true because of an `import`. The one that was false described two blocks
inside one file.** That is the whole difference, and it is visible without understanding either
claim:

> A 「same source」 claim across a module boundary is held up by the import — deleting it breaks
> the build. A 「same source」 claim about two things in the SAME file is held up by nothing but
> the sentence, and the sentence does not run.

`investigationReport.js` was exactly that: two rendering functions, one file, a comment saying
they shared arrays, and one of them parsing the other's output back into structure.

## WHY NO FENCE

A checker cannot tell which two subjects a sentence names. What it could flag — 「a SAME-SOURCE
comment in a file with no import」 — would fire on most of the 19 prose cases and be right about
one. Same arithmetic as M-7, same conclusion.

What is cheap and was done instead: the 7 load-bearing ones are now VERIFIED, in writing, above.
The other 348 are recorded as unverified, which is a truer state than not knowing they existed.

---

# P-1 — THE SESSION STORE IS IN MEMORY. NOT A DEFECT; A PROPERTY.

> **Owner: 「That is not a defect but it is a property I did not know, and it explains a class of
> confusion I will otherwise attribute to something else.」**

`governance/ownerAuth.js`:

```js
function createSessionStore ({ ttlMs = DEFAULT_TTL_MS, ... } = {}) {
  const sessions = new Map()   // id -> expiresAt
```

A plain `Map`, created per process, held only in memory. There is no file, no store, no
persistence of any kind.

## THE CONSEQUENCE, STATED PLAINLY

> **Every restart of 8090 invalidates every owner cookie that exists.** Not on a timer, not on
> expiry — instantly, because the Map that could recognise them is gone with the process.

An open browser tab keeps sending a cookie minted by a process that no longer exists. The server
answers `401 owner_auth_required`, and every owner-gated surface fails at once — settings,
context, intake — with whatever message that surface shows for a bad response.

## WHAT IT LOOKED LIKE ON 2026-08-08

Six restarts between 10:00 and 10:30 while proving the notifier (`DESIGN-RESTART-NOTIFIER.md`).
The Owner's open tab then showed 「讀取設定失敗」 in the settings dialog. Nothing was broken: the
server was healthy, the handler built its payload correctly, `load()` cannot even throw. The
cookie was simply from a dead process, and the page rendered a 401 as a read failure.

**Time from cause to visible symptom: however long the tab stayed open.** That is what makes this
worth writing down — the restart and the error are not adjacent, so the error gets attributed to
whatever changed most recently instead.

## IS IT WORTH CHANGING?

**Not now, and the reason is the same shape as L2-1.** A persistent session store is a file
holding live credentials — a new thing to protect, back up, expire and revoke, added to remove a
re-login after a restart that happens perhaps twice a week. The cost lands on the credential
surface; the benefit is convenience.

What was cheap and IS done: the page now distinguishes 「未登入」 from 「讀取設定失敗」
(`set.notSignedIn` vs `set.loadFailedSaveOff`), so the symptom names its own cause and the fix
is legible from the screen — sign in again.

**Revisit if** either becomes true: restarts stop being rare (a supervisor, a watchdog, frequent
deploys), or something unattended starts depending on an owner session surviving one.

## THE GENERAL FORM

> A property that is obvious from the code and invisible from the screen will be mistaken for a
> defect in whatever was touched most recently. Writing it down is cheaper than re-diagnosing it,
> and this is the second time it has cost a diagnosis.
