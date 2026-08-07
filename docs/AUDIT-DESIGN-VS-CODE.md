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
