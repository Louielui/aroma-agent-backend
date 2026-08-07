# AUDIT — what in the logged-in-browsing design is written, agreed, and NOT implemented

<!-- record-status: ACTIVE 2026-08-06 -->

> **Owner: 「Catching the sign-in gap is the second time a design item was missing from the
> code — the mount that silently did not happen was the first. Both were caught by something
> outside the tests. Say whether anything else in that design file has the same status:
> written, agreed, and not implemented. Check it rather than recall it.」**

**Checked by grepping the code, not by remembering. Steps 1 and 2 were executed last round
(`7679e30`); this is the audit, not a re-run.**

---

# ⛔ THE ANSWER: YES — and the dangerous ones are the layers you think are on

## CATEGORY A — BUILT, TESTED, AND WIRED TO NOTHING

**These are the third instance of the pattern.** They have files, they have passing tests, and
**no code path calls them.** A green suite says they work; nothing says they run.

| item | status | evidence |
|---|---|---|
| **L1 — `paymentStop.js`** | ⛔ **`checkPaymentStop` is called by NOTHING.** `click.js` contains no payment check at all | `grep paymentStop` → only its own file and test |
| **L3 — `requestFence.js`** | ⛔ **not installed by anything in `src/`.** One script installs it — the one I wired to *measure* it | `grep buildRequestFence src/` → nothing |
| **the profile probes** | ⛔ **no runtime enforces 「the session refuses to start if a probe is not clean」.** They run only when I run them by hand | called only from `scripts/` |

> ## The design says L3 is the guardrail. **Today it guards one measurement script.**
>
> If an errand were run right now it would have **no payment recognition and no request
> fence** — the two layers that produced the numbers I reported.

## CATEGORY B — DESIGNED, AGREED, NEVER STARTED

| item | status |
|---|---|
| **the government denylist**, un-overridable, scoped to submission surfaces | ⛔ **zero implementation.** No `blockedOrigins`, no override, nothing. **You approved it and it does not exist** |
| 首頁 stopped-errand line | not started — **and correctly so**, it is last in the build order |
| `POST /api/v1/errand/:id/open` (opens her profile) | not started |
| amount staleness (2h / 24h) | not started |
| the report's five required fields | not started |
| errand store / history | not started |

**Category B is honest**: the build order puts them after the profile, and nothing claims
otherwise. **Category A is not** — those read as done.

---

# ⚠ WHY THIS KEEPS HAPPENING, AND WHAT ACTUALLY CATCHES IT

**Three instances now, and none was caught by a test:**

| | how it was caught |
|---|---|
| the enquiry router never mounted | **a live 404**, after four route tests passed |
| Chrome sign-in absent from `writeProfileDefaults` | **the Owner reading the design against the report** |
| **L1 and L3 wired to nothing** | **the Owner asking me to check rather than recall** |

> ### A unit test proves a component behaves. It cannot prove the component is REACHED. Those are different claims, and only one of them has a test.

**And the reason it is invisible from inside:** every one of these files is *correct*. The
tests are not weak — they are testing the right thing. **What is missing is a test that
something else calls them**, and that test is the one nobody writes because the component you
just built is vividly present in your mind.

## The mechanism, and it already exists in this codebase

`routeTableSmoke.test.js` was built after the unmounted router, and **it was proven to go red
when the mount is removed.** That is the shape: **a test that fails when the WIRING is removed,
not when the component is.**

**The equivalent for these three does not exist yet**, and writing it is the correct next step —
before, not after, the profile is used.

---

# WHAT I AM NOT DOING

**Not wiring them in this round.** The build order puts the session runner after the profile,
and wiring L1 and L3 into a runner that does not exist would be inventing the runner to justify
the wiring.

**What this audit changes is the honesty of the status**, not the plan:

| I reported | the truth |
|---|---|
| 「L3 is the guardrail, free to read, 51 writes refused」 | **all true, and it is installed in one measurement script** |
| 「L1 is a convenience at 45%」 | **true, and it is a convenience that is currently switched off** |
| 「the probes refuse to start a dirty session」 | **the probes work. Nothing refuses anything, because nothing starts a session** |

**No errand has run with either layer except the one I explicitly wired for the measurement.
That was never stated, and it should have been.**

---
---

# RESOLVED — the layers are LIVE, and here is how I know

**Built in one round at the Owner's instruction, after he had already logged into Costco
Business Centre in the profile. No errand has been run since.**

## WHICH LAYERS ARE LIVE — and the evidence is a test that fails without the wiring

> **Owner: 「tell me which layers are live and how you know — not which files exist.」**

| layer | where it is attached | **proven red when the wiring is cut** |
|---|---|---|
| **L1 payment stop** | inside `click()`, before anything is pressed | ✅ **1 failure** |
| **government block** | inside `checkNavigation()`, **before** the allowlist | ✅ **2 failures** |
| **government block on the ORDER** | in `openBrowserSession`, before a browser exists | ✅ **1 failure** |
| **the four probes** | in `openBrowserSession`, before launch | ✅ **4 failures** |
| **L3 request fence** | `page.route('**/*')` at session open | ✅ **1 failure** |

**Each was proven by deleting its call site, running `wiringSmoke.test.js`, and restoring the
file.** Five cuts, five reds, zero cuts that stayed green.

> ## A component test proves behaviour. These prove REACH — and reach is what was missing three times.

## What the session refuses to do

- **It refuses to OPEN, not to warn.** A dirty probe means **no browser is launched at all** —
  the test asserts this by making `launchPersistentContext` throw if it is ever called.
- **An order naming a blocked origin is refused before a browser exists** — the mistake is
  caught when the order is written, not when it is acted on.
- **`UNREADABLE` is unclean** (HR-23), and a held lock stops the session without deleting
  anything.
- **A CRA origin is refused even when the order explicitly names it**, and refused for the
  *same reason* whether named or not.
- **`recalls-rappels.canada.ca` is NOT blocked** — a test asserts it, because a `*.gc.ca`
  pattern would kill ERRAND-003, the only errand that has ever produced an answer.

---

# ⛔ THE OMISSION IS THE LESSON, NOT THE GAP

> **Owner: 「Record that 『check, do not recall』 found what three rounds of green tests could
> not. And record your own sentence.」**

> ## 「除咗我為量度而明確駁咗嗰一單，冇任何差事帶住任何一層跑過。呢句我從來冇講，而我應該講。」

**Three rounds of green tests did not find this. One instruction — 「check rather than recall」 —
found all four in about ninety seconds of grepping.**

**The gap was ordinary**: components built before the thing that calls them, which is the normal
order of work. **The omission was not.** I reported 「L3 is the guardrail, free to read, 51
writes refused」 and 「L1 is a convenience at 45%」 without ever saying **that neither had run
outside the one script I wired to measure it.**

| what I said | what was also true and unsaid |
|---|---|
| the measurements | **accurate** |
| 「the guardrail」 | it guarded one measurement script |
| 「a convenience」 | a convenience that was switched off |

**Every sentence was true. The set of them was misleading**, and nothing in a test suite can
catch that — it is a property of what was reported, not of what was built.

**The mechanism, and it is now in the code rather than in this paragraph:** `liveLayers()`
answers 「what is on?」 from the session itself, so the next report can state it from a running
object instead of from a memory of having built something.
