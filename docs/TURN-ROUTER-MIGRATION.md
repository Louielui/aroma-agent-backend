# Turn Router migration — agreed scope, step by step

The intent-first router replaces the current order (read everything, then classify) with
routing before any read. Four steps, **each needing its own Owner GO**. This file is the
record of what each step covers, written down as it is agreed rather than reconstructed
afterwards.

Origin: 「現在是幾點？」 read Drive, Gmail, Calendar and the Aroma System inventory, then
reported it could not reliably answer. Three correct mechanisms in the wrong order.

---

## Step 1 — the router, shadow only ✅ DONE (`49ac507`, 2026-08-04)

`src/intake/turnRouter.js`. Pure, free, zero-context. `TURN_ROUTER` defaults to `off`; the
live launcher sets `shadow`. It decides nothing — it logs its verdict beside what the
pipeline actually did, so the Owner can see **disagreements**, not classifications.

Byte-identical behaviour with the flag off was proved by differential run against the parent
commit — `scripts/diff/behaviourSurface.js` + `compareSurface.js`, surface identical at
14,021 bytes, logs identical.

**Currently running.** The Owner is accumulating real turns. Step 2 does not begin until
those turns have been reviewed, and the review leads with disagreements.

---

## Step 2 — trusted time, the UTILITY route, and the empty screen

**Not started.** Needs its own GO.

### 2a. Owner Settings timezone — the prerequisite

There is no configured timezone today. The only `America/Winnipeg` in the codebase is a
**hardcoded literal** at `src/lab/conversationRecall.js:77`, used to format archived record
timestamps; `startOfLocalDay` (`src/context/readContext.js`) separately uses `setHours()`,
i.e. the **process's OS timezone**. The two agree today by coincidence of configuration, not
by contract, and would silently diverge on a different machine.

- Add a timezone field to Owner Settings, default `America/Winnipeg`.
- `conversationRecall` and `startOfLocalDay` both read **that single source**.
- Never the OS timezone implicitly.

This is a prerequisite for everything else in Step 2: a UTILITY answer about the time and a
time-of-day greeting are both wrong without a trusted clock.

### 2b. The UTILITY route goes live

Time / date / calculator / unit conversion answered from the server's own clock and
arithmetic. No business connector, no business EvidenceSet, no Answer Plan.

Note: the current time reaches the model today **only** as `Retrieved at: <UTC ISO>` inside
the read block, labelled as when the read happened, with no timezone. With `READ_ACCESS`
off she has no clock at all. UTILITY must supply the time deterministically from the server
— never ask the model.

### 2c. Delete the inventory fallback — do not leave it dormant

`aromaMethodFor` in `src/context/readContext.js` ends 「no intent match => inventory」. That
default is where the inventory records in the original failing turn came from. Owner
instruction: once routing governs reads it must **stop existing**, not sit dormant behind a
guard — a dormant default is one refactor away from being reachable again, and it is silent
when it fires. A warning is already written at the function.

### 2d. Empty-screen redesign — Owner request, 2026-08-04

Held deliberately for this step: a time-aware greeting needs the trusted clock from 2a, and
there is no point doing the layout twice.

- Replace the canned assistant bubble on an empty conversation with Claude's shape: a
  **centred, time-aware greeting**, the composer beneath it, **nothing else**. No bubble, no
  avatar, no instructions, no copy button.
- The greeting **disappears the moment the first message is sent**.
- It reads the **Owner Settings timezone** from 2a — the same single source `startOfLocalDay`
  and `conversationRecall` read. Never the OS timezone implicitly.
- Written Traditional Chinese. The Owner's name stays **「Louie」**, never transliterated
  (Owner Language Policy).

**The text being replaced** (`src/demo/assets/app.js:1195`):

> 我係香香。有咩想傾，或者想我幫你做啲咩？
>
> 想我改嘢，直接講明改邊個檔案同改乜就得 —— 我會出一張工作單畀你過目，**你批准咗我先會做**。

**OPEN QUESTION, to resolve at the start of Step 2 — not decided here.** The second paragraph
is a **real affordance**, not decoration: it is the only place that tells the Owner how to
reach the ACTION path and that approval gates execution. Owner instruction is to **propose
where it goes, not delete it to tidy the screen.** Candidate homes to weigh then — a
first-run-only hint, the composer placeholder, a help affordance near the composer, or the
settings page. Do not drop it silently.

**Overlap worth knowing:** that bubble is Cantonese, so it is also on the Language Policy
Round 2 list (presentation strings). If Step 2 replaces it, Round 2 need not touch it —
check before doing the same string twice.

---

## Step 3 — routing governs reads

**Not started.** Needs its own GO.

The read guard at `src/intake/intakeService.js:309` changes from `isChat && READ_ACCESS==='on'`
to being driven by `route.sources`, so CONVERSATION and UTILITY turns read nothing and a
BUSINESS_QUERY reads only the tools its intent declares.

`answerPlanFormat()` (`src/intake/intakeService.js:~401`) gains a route condition, so
retrieved rows can no longer make the Answer Plan mandatory on their own.

**Open question for this step:** the invoice intent declares `sources: ['aroma_system', 'gmail']`.
The Owner's test expectation is that Gmail stays untouched during an invoice query "unless
specifically required". Decide whether the intent table's own declaration counts as
"required" before this lands.

---

## Step 4 — the Route / Evidence Guard

**Not started.** Needs its own GO.

Blocks an unsupported operational answer when
`route === 'CONVERSATION' && operationalClaimsDetected && evidenceCount === 0`, replacing it
with 「這個問題需要查詢 Aroma System 才能可靠回答，目前尚未取得相關證據。」

The detection backbone already exists and is verified: `evidenceIndex([], [])` +
`sentenceIsSupported` distinguishes an operational claim from advice deterministically, in
both digit spellings. Its **known limit**: it only validates numbers, so a numberless claim
（「供應商狀態正常」）needs a second, keyword-anchored entity+state layer — which must carry
its boundary in a file header, the same way `scopeNotes.js` does.

Surfacing rule: routine telemetry is never shown. The Owner sees something **only** when an
answer was withheld.

---

## Accepted losses, recorded once (see also the `turnRouter.js` header)

- **Pronoun continuation.** 「嗰啲呢？」 after a business question routes to CONVERSATION.
  The obvious fix — letting Conversation Recall inform routing — is forbidden: recall may
  preserve continuity but may never select a tool, or an untrusted archived sentence becomes
  able to trigger a connector read. One extra turn is the accepted price.
- **Implicit business questions with no vocabulary hit** fall to CONVERSATION; Step 4's guard
  is what stops them being answered anyway.
- **One message, one route.** 「而家幾點？順便睇下發票」 yields UTILITY only.
