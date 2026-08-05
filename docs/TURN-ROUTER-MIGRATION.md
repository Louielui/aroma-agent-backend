# Turn Router migration — COMPLETE

The intent-first router replaced the old order (read everything, then classify) with routing
before any read. Four steps, each with its own Owner GO. This file was written as each step
was **agreed**, and is now closed out with what each step **actually did** — including where
that differed from the plan.

Origin: 「現在是幾點？」 read Drive, Gmail, Calendar and the Aroma System inventory, then
reported it could not reliably answer. Three correct mechanisms in the wrong order.

**Status: all four steps done and live.** Closed 2026-08-05 at `8c6a75b`, tag
`turn-router-complete-20260805`.

| Step | Shipped | Commit |
|---|---|---|
| 1 — router, shadow only | 2026-08-04 | `49ac507` |
| 2 — clock, UTILITY route, inventory default, empty screen | 2026-08-04/05 | several |
| 3 — routing governs reads | 2026-08-05 | several |
| 4 — Route/Evidence Guard | 2026-08-05 | `8c6a75b` |

---

## Step 1 — the router, shadow only ✅

`src/intake/turnRouter.js`. Pure, free, zero-context. It decided nothing; it logged its
verdict beside what the pipeline actually did, so the review could lead with **disagreements**
rather than a list of classifications.

Byte-identical behaviour with the flag off was proved by differential run against the parent
commit — `scripts/diff/behaviourSurface.js` + `compareSurface.js`, surface identical at
14,021 bytes.

**AS BUILT vs PLANNED — two things the plan did not anticipate, both recorded rather than
tidied away:**

1. The first comparator reported **"0 differences" because BOTH sides had errored**
   (`require()` with POSIX paths on Windows). A false green of exactly the kind this project
   spent the week eliminating. `compareSurface.js` now refuses to report identity until it has
   proved the measurement ran at all.
2. The harness **wrote 25 real records into the Owner's live data**, because `AROMA_DATA_DIR`
   defaults to production. The scratch directory is now a required argument. **The root cause
   is still open — see `MAINTENANCE-BACKLOG.md` M-3.** Owner ruling: fix the default before
   cleaning the store.

---

## Step 2 — trusted time, the UTILITY route, the inventory default, the empty screen ✅

**2a. Owner Settings timezone.** `src/utils/localTime.js` is now THE single clock:
`resolveTimeZone`, `startOfLocalDay`, `formatLocal`, `localParts`, `isValidZone`. Both
`conversationRecall` and the read context read it. An unknown IANA name **fails loudly at read
time** — it never silently degrades to UTC or to the OS zone, per Owner instruction.

*As built:* two defects found by tests during this step and worth remembering —
`startOfLocalDay(new Date())` returned `05:00:00.748Z` (milliseconds leaking into the offset),
and two of my own tests asserted opposite things about `null` for the timezone field.

**2b. The UTILITY route went live.** Time / date / calculator / unit conversion, answered from
the server's own clock and arithmetic. No connector read, no EvidenceSet, no Answer Plan, and
**no model call at all** — the route is free. It declines rather than guessing: `answerUtility`
returns null when it cannot answer deterministically and the turn falls through.

*As built — THE MOST IMPORTANT LESSON OF THIS STEP.* 「5磅是多少公斤？」 was not captured, and
the cause was not the missing words. **The router had grown its own private unit list**, and
the unit test called `answerUtility` directly, bypassing the router entirely. The fix was
structural, not lexical: ONE vocabulary per concept (`UTILITY_PATTERNS` lives in
`utilityAnswer.js`; `turnRouter.js` holds none), **23 bypassing tests deleted**, and a
meta-test that fails if any test calls the answerer without going through the router.

**2c. The inventory default is gone.** `aromaMethodFor`'s 「no intent match ⇒ inventory」 was
**deleted**, not left dormant behind a flag, per Owner instruction — a dormant default is one
refactor away from being reachable and is silent when it fires.

**2d. Empty screen.** Centred, time-aware greeting reading the 2a timezone; composer beneath;
nothing else. The greeting disappears on the first message. Owner's name stays **「Louie」**.

*The open question was decided by the Owner, not by me:* the ACTION-path affordance was **not
deleted to tidy the screen** — it moved into the **composer placeholder**. The governance
sentence (approval gates execution) was kept, explicitly: 「Do not silently delete a governance
statement to tidy a screen.」

---

## Step 3 — routing governs reads ✅

Reads are driven by `route.sources`, **intersected** with what `READ_ACCESS` and the per-source
switches already allow — never unioned. A route can only ever narrow the Owner's own switches.
CONVERSATION and UTILITY turns read nothing. `answerPlanFormat()` gained a route condition, so
retrieved rows can no longer make the Answer Plan mandatory on their own.

**The open question was ruled on by the Owner.** The invoice intent declared
`sources: ['aroma_system', 'gmail']`. Ruling:

> The intent table's declared sources are a HINT about where an answer might live, not an
> authorisation to read. For an invoice question, read `aroma_system`. Do NOT read Gmail.
> Gmail is the most sensitive source I have connected; reaching into mail on a hunch is the
> wrong default for the most sensitive connector.

Verified live, not assumed: a capability question performs **zero** connector calls, and an
invoice question calls `aroma_system` only. ("You have had two vacuous zeros this week; earn
this one.")

---

## Step 4 — the Route/Evidence Guard ✅

`src/intake/routeEvidenceGuard.js`. Catches a business question that fell to CONVERSATION and
would be answered with operational claims and zero evidence — the gap Steps 1–3 left at the
*answer* end. Verified live on 「今日邊啲貨要補？」, which routes to CONVERSATION today because
the intent table has 補貨 but not 要補.

**Numeric half:** reuses `sentenceIsSupported()` against an **empty** evidence index, so every
quantity in prose — ASCII or CJK — is unsupported by construction. No second implementation.

**Entity-plus-status half:** matches the intent table's own nouns. Porous; see the open item
below.

**Withholding is visible, never silent.** Offending sentences are removed, clean sentences
survive, and a **server-generated** line states how many were withheld, that no source was
consulted this turn, and which source would answer it properly.

*As built vs planned, three differences:*

1. **The planned canned sentence was replaced.** The plan had a fixed
   「這個問題需要查詢 Aroma System…」. Shipped instead: a counted, source-named line that ends in
   an **offer to check now**. The Owner should never be told what cannot be done without being
   offered the thing that can.
2. **Three exemptions, for one reason** — they are not claims about the business: a question,
   an offer, and a statement of what she can do. The third is load-bearing: without it the
   guard withholds a capability list, and a false withholding teaches the Owner to distrust
   the control.
3. **Wired as a WRAPPER** around `buildReadResultReply`'s three exits, not at one of them. The
   read-state guard already taught this: `directAnswer` went unchecked for weeks because the
   guard sat on a draft rather than on the finished text.

**Not flag-gated, deliberately.** The guard calls `routeTurn()` directly to decide its own
scope. `routeTurn` is pure, free and zero-context, so this costs nothing and means the guard
protects the answer end even if `TURN_ROUTER` is off.

---

## OPEN ITEMS — carried forward so they survive the conversation they were found in

### O-1. The guard's blind spot: no number, no entity noun

`routeEvidenceGuard.js` **cannot catch an operational claim carrying neither a number nor one
of the intent table's nouns**. 「今日一切正常，不用做什麼。」 passes straight through. It is
pinned by a test that asserts the miss rather than hiding it.

This is the **same** blind spot that sent the turn to CONVERSATION in the first place: the
guard shares the router's vocabulary, so **it cannot catch what the router could not route**.
The two fail together, by construction.

**THE FIX IS TO WIDEN `INTENTS` IN `readContext.js`, WHICH NARROWS THE HOLE IN THE ROUTER AND
THE GUARD AT THE SAME TIME. Do not grow a second vocabulary in the guard** — a test fails if
that file gains its own noun list, and "one vocabulary per concept" was paid for once already
in Step 2b.

### O-2. Pronoun continuation — accepted as a v1 loss

「嗰啲呢？」 after a business question routes to CONVERSATION. The obvious fix — letting
Conversation Recall inform routing — is **forbidden**: recall may preserve continuity but may
never select a tool, or an untrusted archived sentence becomes able to trigger a connector
read. One extra turn is the accepted price. Owner: "v1 accepts the loss."

Related, same category: **one message, one route** — 「而家幾點？順便睇下發票」 yields UTILITY
only.

### O-3. Nearness distribution — n = 2, revisit when the record has accumulated

Drop records now carry a server-computed `score` and `nearness` (`paraphrase` / `partial` /
`unrelated`), measured on the **full** value with only the score leaving. Of 45 drop records in
the log, **only the last 2 carry it** — scoring landed 2026-08-05 — and the earlier 43 **cannot
be reconstructed**: the values are deliberately not retained and the evidence is not archived.

Today: **2 of 2 unrelated** (0 and 0.06). That is not a distribution and must not be reported
as one. The Owner has a wording decision waiting on it — whether 「有 N 個數值無法核對」 is
misleading for a value that was one character off — and it stays **unruled** until there is a
real sample. Revisit after several weeks of live turns.

Caveat to state whenever this is reported: the score is character-level, so a **correct value
in a different notation** (`16:00` written 「下午四時」) also scores 0.

### O-4. The 冇 experiment — still open, awaiting a natural turn

Whether the schema description drives her to write 冇 is **not settled**. My first explanation
was disproved by my own test: the rewritten description provably reached the model and 冇
appeared anyway. Since then she has not written a negation at all, so there has been nothing
to observe.

Owner ruling: **leave it open and let it come up naturally.** No contrived turn — "I would
rather have a real turn than a contrived one."

### O-5. The repo default for `TURN_ROUTER` — recommend flipping to `on`, needs a GO

The launcher (`C:\Aroma\xiangxiang.ps1:103`) sets `on`. The **repo default is `off`**
(`turnRouter.js:resolveFlagValue`), which now means:

- the UTILITY route never runs, and
- `routeGoverns` is false, so **every enabled source is read on every chat turn** — the exact
  defect this whole migration existed to remove.

`off` is therefore no longer "the old behaviour"; it is a configuration nothing is tested as a
whole and nobody runs. Recommendation: **flip the default to `on`**. Changing it touches
`turnRouter.js:149` and the tests that pin the default (`turnRouter.test.js:131`,
`routingGovernsReads.test.js:236`, `noIntentNoRead.test.js:186/218`) — those pin the `off`
BEHAVIOUR and should be rewritten to set `TURN_ROUTER: 'off'` explicitly rather than deleted,
so the legacy path stays provable. **Not done — awaiting Owner GO.**
