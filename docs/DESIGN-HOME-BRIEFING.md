# 首頁 — the two design questions, answered before building

<!-- record-status: ACTIVE 2026-08-07 -->

---

# 1. DOES IT REPLACE THE CONVERSATION PANE, OR SIT BESIDE IT? — **NEITHER, AND THE REASON MATTERS**

> **Owner: 「The conversation is what works today and I do not want it demoted to a tab.」**

## What exists today, measured

`renderEmptyScreen()` in `app.js` shows the greeting **only when the conversation is empty**:

```js
if (!mainEl || isListed(c) || c.history.length > 0) return
```

**The greeting — and the Franco line attached to it — disappear the instant he types.**

> ## ⛔ That is fatal for a briefing, and it is the actual defect behind 「I see a blank greeting」.
>
> A stopped errand waiting for a decision would **vanish from view the moment he starts a
> conversation**, which is the one moment he is most likely to be doing something else.

## The answer: 首頁 IS the empty screen, expanded — plus ONE thing that survives typing

| | |
|---|---|
| **the full briefing** | renders where the greeting is now — the empty screen, before a conversation starts |
| **⛔ anything WAITING ON HIM** | **persists as a compact bar above the thread, for as long as it is waiting** |

**Not the whole briefing beside the conversation** — that is the 「demoted to a tab」 shape from
the other direction, a permanent panel competing for the same screen.

**Only the waiting items persist**, because those are the only ones with a deadline. 「What she
ran today」 can wait for the next empty screen; **「a cart is priced and unpressed」 cannot.**

> ### The conversation keeps the whole screen. The briefing takes the space that is currently empty. A decision waiting on him is the single exception, and it is one line.

---

# 2. WHAT IT SHOWS ON DAY ONE — **honestly, it would be a stub, and here is what it needs**

## What is real today

| line | status |
|---|---|
| **the Franco backlog** | ✅ **real** — a live read of two Drive folders, 64 files, oldest 53 days |
| **the greeting** | ✅ real, resolved in his timezone |
| **what she has run** | ⛔ **EMPTY, and permanently so** |
| **anything waiting on him** | ⛔ **EMPTY, and permanently so** |

## ⛔ Why the errand list would be empty forever

**There is no errand store.** Every errand this week — the recall check, the Costco run, the
invoice attempt — was **a script I ran by hand**. Nothing recorded them. The audit found
`errandStore` at **0 hits** and that has not changed.

> ### So 首頁 on day one is one Drive line in a frame, and an empty list that a tired reader cannot tell from a broken feature.

**That is exactly the `count: 43` shape**, which is why the 「never blank」 ruling already
exists — but a rule that makes emptiness honest does not make it *useful*.

## What it needs before it earns being the first screen

**Two things, and only the first is in this build:**

1. **An errand store that errands actually write to** — built here, with the recall errand
   wired to it as the proof. **Without this the list is decoration.**
2. **At least one errand that runs regularly enough to fill it.** ERRAND-003 (the recall check)
   is the candidate: **it works, it is useful, and it costs `$0.00`** — but **she has no
   scheduler**, so today it only runs when I run it.

> ## The honest statement: after this build 首頁 shows one real Drive line, and an errand list that is real but only fills when I run something by hand. It earns being the first screen when the second thing exists, and not before.

**I am building it anyway**, because the surface has to exist before anything can fill it, and
because 「stopped, waiting for you」 has no other home. **But it should not be described as a
briefing until something briefs it.**

---

# WHAT IS BEING BUILT — held rulings

| ruling | how |
|---|---|
| three outcomes never merged | `ANSWERED` / `STOPPED_FOR_YOU` / `BLOCKED_BY_SITE`, separate states end to end |
| the stop report **inline**, not a link | the waiting card carries the five fields |
| Franco line **off the greeting** | its own row in the briefing |
| **never blank** | 「冇差事跑過」 and 「我睇唔到差事紀錄」 are different lines and never collapse |
| **timestamped** | every claim carries the time it was made |
| **amounts age out** | plain < 2h · struck through 2–24h · **absent > 24h** |
| **the link stays open at any age** | 過期嘅係主張，唔係 access |
| **open-the-page** | refuses cleanly if she holds the profile; **never auto-clears a stale lock** |

---

# OPEN QUESTION — the follow-up that needs to know what he was reading

<!-- opened 2026-08-07 · NOT SOLVED · do not close with a composer -->

首頁 has no composer, and that is correct: it is a report, not a conversation. But it leaves a
real problem, and the Owner named it precisely.

> **Owner, 2026-08-07: 「「點解青蔥查唔到」 needing to reach a conversation that knows what I was
> reading — you are right that a bare composer would be worse than none. Record it as an open
> question, do not solve it now. But note that it is the reason I will keep wanting a composer
> there, so whatever eventually goes in that space has to carry context or it will be this bug
> with a nicer failure.」**

## The shape of the problem

He reads a conclusion — 「青蔥查唔到」 — and wants to ask about it. Today he must leave 首頁, open
a conversation, and **retype the context she already has on screen**. That friction is the reason
a composer keeps looking like the answer.

## Why a bare composer is not the answer

It would start a conversation that does not know what he was looking at. **It would look like it
continues from the report and would not** — which is the same failure as HR-42 wearing a nicer
face: an input that appears to do one thing and does another.

## The bar any solution must clear

> ### Whatever goes in that space must CARRY THE CONTEXT — the errand, the conclusion, the row he
> ### was reading — into the conversation it opens. If it cannot, it does not go in.

Candidate shapes, none chosen: a per-item 「問下」 affordance that seeds the turn with that item;
a composer that shows what it will attach before he types; or nothing, permanently, with the
answer being that he asks in conversation and she reads the same briefing he is reading.

> ### ⛔ ENFORCED BY: `src/demo/sidebar.test.js` → 「首頁 has no composer」, which fails if a bare
> ### composer is added back. It does NOT enforce that a context-carrying one is correct — that
> ### needs its own test the day one is designed.
