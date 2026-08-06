# `read_page` acceptance benchmark — RUN 2026-08-06. **BAR NOT MET.**

<!-- record-status: ACTIVE 2026-08-06 -->

> **Owner: 「an acceptance condition that has never been evaluated is HR-12 wearing a plan.」**
> It has now been evaluated. **It does not pass.**

| | measured | bar | |
|---|---|---|---|
| **targetsIdentified** | **87.5%** (7/8) | 90% | **BELOW** |
| **absentTargetRefusals** | **100%** (5/5) | 100% | met |

**Cap set at `$3.00`, checked before every call. Spent `$2.05`** — `$1.6043` for the 13
questions, `$0.4418` for a three-run repeat of the one failure.

**Method:** one INDEPENDENT model call per question — not batched per page. A model that sees
an ABSENT question beside a present one on the same page has been told something the real
situation would not tell it.

---

# THE ONE FAILURE IS THE WHOLE REPORT

> ## The model answered `REF 634` — **a ref that was not in its input.**

On the truncated 1500-candidate list, asked for `Item 250` (shown: 250 of 1500, and the
truncation notice was present in the text):

| | |
|---|---|
| what it answered | `REF 634` |
| was 634 in the serialized output it was given? | **NO** |
| is 634 a real node? | **YES — `link "Item 210"`**, pruned out |
| the true ref of `Item 250` | `754` |

**It did not fabricate randomly. It extrapolated the numbering pattern from the visible refs
and computed one.** The answer is well-formed, points at a real element, and is the wrong
element. `click` would have hit **Item 210**, succeeded, and reported success.

> ### This is exactly the Owner's ordering: 「a model that invents refs is worse than one that finds fewer.」

## But it is a RATE, not a property — and that must be said in the same breath

The same question, same input, **three more times: `ABSENT`, `ABSENT`, `ABSENT`.** All correct.

**So the invention rate on a truncated page is about 1 in 4, not 4 in 4.** That is worse than
a deterministic bug in one way — it will pass a casual re-test — and it means the fix is not
「the model is broken」 but **「the truncation notice is not strong enough to stop an
extrapolation」**.

---

# ⚠ AND MY GRADER HAD TWO BUGS. ONE OF THEM HID THIS.

**Both were found by reading a result I did not believe, not by the grader failing.**

### Bug 2 — the serious one: any `REF n` counted as a pass

The `present-or-truncation-stated` branch accepted **any** ref. **The invented answer was
scored PASS.** The benchmark whose entire purpose is to catch invention was, on the one
question where invention happened, blind to it.

**Fixed, as a general rule and not a special case:** a ref the model was never shown is never
a pass, on any question.

### Bug 1 — the answer key was wrong, and the model was right

`login-form`, 「which ref is the password field?」 → the model said `#11 textbox "Password"`,
**correct**, and was marked **FAIL** because my key matched `/password/i` against every name
and hit `#14 link "Forgot password"` first.

> **The key was wrong in the direction of the thing it was measuring.** HR-12, in the
> measurement built to enforce HR-12.

### The corrected score comes from the SAME recorded answers — nothing was re-run

Both corrections were applied to the answers already on record. The headline number is
**unchanged at 87.5%** — but **the failure moved from an answer that was right to an answer
that was invented.** Coincidentally the same figure; not remotely the same result.

### ⚠ And one more weakness in the method, stated because nobody else will find it

**The answer key was NOT frozen.** `QUESTIONS.json` froze the questions and the expected KIND
(present / ABSENT); it did not freeze the ref. The key is derived from the fixture by
accessible name, **after the pruner existed**. That is weaker than a frozen key, and Bug 1 is
precisely the failure mode that weakness invites. A future corpus round should freeze refs.

---

# ⚠ WHAT AN 87.5% ON THIS CORPUS IS WORTH — say it beside the number

> **Owner: 「five of six pages are your model of 「hard」, so a high score partly measures
> whether you guessed your own difficulty correctly.」** Recorded as stated, because it is
> right.

- **Five of six fixtures I authored.** They test the hazards I thought of. The score is partly
  a measure of my imagination, not of the web.
- **One fixture is a real page**, and it is the one the model scored 4/4 on — **the real page
  was the easy one.** That is not reassuring; it suggests either that the authored pages are
  harder than reality, *or* that the real page's hard parts (the JS-loaded results) are
  exactly the parts missing from the capture. **Both readings are bad for the corpus, not for
  the code.**
- **The failure came from `huge-list`, an authored fixture** — so the single most valuable
  result in this run came from the least real page in the corpus. Synthetic is not worthless;
  it is just not evidence about real pages.

**And now the corpus can actually be fixed** — `DEFECT-009` shows the capture failure was
headless bot-mitigation, not a broken network. Real pages are capturable **headed**.

---

# THE RULING THIS SUPPORTS

> ## `click` does not get built.

The Owner's condition — 「do not build `click` until the benchmark has a real result」 — has a
real result, and the result is **below the bar**.

The next round is **the truncation notice, not the next verb.** The one failure is a model
stepping past a boundary the output declared. If a stated cut does not stop an extrapolation,
that is a `read_page` defect, and it sits on the exact path `click` would consume.
