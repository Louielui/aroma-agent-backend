# STANDING REQUIREMENT — 香香 operates a computer HERSELF

<!-- record-status: ACTIVE 2026-08-06 -->

**Owner decision, 2026-08-06. This is a REQUIREMENT, not a preference, and it survives every
future conversation.**

---

# The requirement

> ## 香香 MUST have her own ability to operate a computer — online and browser, and offline and desktop.
> ## **Not by dispatching to another product.**
>
> **Writing code she may delegate. Operating a computer she may not.**

# The reasoning, recorded so nobody later reads it as taste

> **Operating a computer is a BODY, not a skill.** Delegating it means renting hands.
>
> A worker that can be **withdrawn, deprecated, or repriced** is not a capability she has —
> it is a capability she **borrows**. And the whole architecture says invest in capabilities,
> not vendors.

The distinction is not about quality or convenience. A borrowed body is one commercial
decision away from being gone, and everything built on top of it goes with it.

---

# ⚠ HOW THIS CONSTRAINS DESIGN — read this before proposing anything

> ### Any proposal that satisfies 「she can operate a computer」 by dispatching to Cowork, Claude in Chrome, or any other product **satisfies a DIFFERENT requirement**.
>
> It must **say so plainly** rather than reading as completion.

A design document, a plan, or a working demo that routes through another product is not
progress against this requirement. It may be valuable — see Track A — but it must be labelled
as what it is, in its own first paragraph, and must never be recorded as 「done」 against this
page.

**The test:** if the other product disappeared tomorrow, does she still have hands? If no,
this requirement is untouched no matter what was built.

---

# TWO TRACKS, IN PARALLEL

## TRACK B — THE REQUIREMENT. The destination.

Her own action set:

| online | offline |
|---|---|
| `navigate` · `click` · `type` · `read_page` · `wait_for` · `screenshot` | files · windows · applications |

**Estimated in months.**

> ### It does not get dropped because the bridge works.
> A working Track A is the single most likely reason Track B quietly stops being funded, and
> that is exactly the outcome this page exists to prevent.

## TRACK A — A BRIDGE. Scaffolding, with a removal condition.

So the Owner is not idle for months. **If** a dispatch path into Cowork exists, she uses it
for real work now — starting with IG posts through Canva.

**It is explicitly temporary.**

| | |
|---|---|
| **status** | scaffolding, never architecture |
| **removal condition** | **replaced by Track B when Track B lands** — removed, not left beside it |
| **how it must be described** | 「a bridge into another product」, never 「she can operate a computer」 |

Recording it as scaffolding is not a formality. Scaffolding that is never labelled becomes
load-bearing by default, and then removing it is a project of its own.

---

# The first step, and only this

**Measure whether Track A is even possible.** Nothing is designed past that answer.

See `DESIGN-VISUAL-OPERATION.md` for what has already been measured about the action set and
the fence, and for the step-0 result on the headless CLI (`TOOL_NOT_AVAILABLE`).
