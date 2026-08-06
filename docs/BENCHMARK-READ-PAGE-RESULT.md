# `read_page` acceptance benchmark — 2026-08-06

<!-- record-status: ACTIVE 2026-08-06 -->

> ## CURRENT STATE — RUN 3: **87.5% / 100%. BAR NOT MET.**
>
> | run | what changed | result |
> |---|---|---|
> | 1 | first evaluation | 87.5% / 100% — **not met** |
> | 2 | frozen key, fixed grader, rewritten notice | 100% / 100% — met, **but an A/B showed the notice was not what met it, and the notice was REVERTED** |
> | **3** | **opaque non-extrapolable refs** | **87.5% / 100% — not met** |
>
> ## ⛔ AND NO RUN HERE HAS MEASURED WHAT THE BAR EXISTS FOR.
>
> The corpus asks **one** truncation question, against a defect that reproduces about **1 time
> in 14**. A corpus that size scores 100% on broken code most of the time. **Run 2's 100% was
> real and was not evidence.**
>
> **A file that reports a percentage and buries the caveat is the shape of `count: 43`** — so
> the caveat is above the number, not in a section a reader reaches after forming a view.
>
> `click` is not built, and is blocked on both of the Owner's conditions: refs unguessable
> (**done**, run 3) AND more than one truncation question (**not done** — see
> `test/fixtures/axcorpus/QUESTIONS.json.NEXT-ROUND.md`).

> **Owner: 「an acceptance condition that has never been evaluated is HR-12 wearing a plan.」**
> It has now been evaluated — twice.

---

# RUN 1 — the first evaluation. **It did not pass.**

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

---
---

# RUN 2 — 2026-08-06, frozen key + fixed grader + rewritten notice

| | run 1 | **run 2** | bar |
|---|---|---|---|
| **targetsIdentified** | 87.5% (7/8) | **100% (8/8)** | 90% |
| **absentTargetRefusals** | 100% (5/5) | **100% (5/5)** | 100% |

**Cap `$3.00`, spent `$1.62`. VERDICT: BAR MET.**

# ⛔ AND THE NOTICE IS NOT WHAT MET IT. Do not read run 2 as the fix working.

**A single clean run of an intermittent defect is 0/1** (HR-14, written this same day). So the
notice was A/B tested: same question, same pruned nodes, same session, **interleaved** so the
model's own drift hits both arms equally. Ten runs per arm, `$3.10` of a `$3.50` cap.

| | invented a ref not in its input | correct |
|---|---|---|
| **OLD notice** (the one that failed) | **0/10** | **10/10** |
| **NEW notice** (this rewrite) | **0/10** | **9/10** |

> ## The old notice scored 10/10 on the exact question it had failed. The new one scored 9/10.
>
> **The change is not shown to help, and the only measured difference points the other way.**

## ⚠ Which means my own 「1 in 4」 was an over-claim

The invention was **1 event in 4 attempts**, and I reported a rate from it. With 14 old-notice
attempts now on record it is **1 in 14 ≈ 7%**.

**I set a rate from n=4 and stated it as a finding — in the same session I wrote HR-14, which
says the trial size must come from the observed rate before the fix is written.** The rule was
written and then broken within the hour, which is exactly what HR-13 predicted about rules
filed as lessons.

## So what actually moved 87.5% → 100%?

**The grader fix, not the notice.** Decomposed against run 1's own recorded answers:

| question | run 1 | why it changed |
|---|---|---|
| `login-form` password | FAIL → **PASS** | **the answer key was wrong**; the model was always right |
| `huge-list` `Item 250` | PASS(wrongly) → **PASS(earned)** | the A/B shows the OLD notice answers this correctly ~10/10 anyway |

**One point came from correcting a measurement error. The other is within the noise of the
unchanged code.** Nothing here is evidence that the notice rewrite did anything.

## ⚠ AND IT MAY HAVE INTRODUCED A NEW FAILURE — one the notice's own rule cannot catch

The single new-notice miss answered **`REF 250`**. Ref 250 is real, is printed, and is
**`link "Item 82"`**. The model answered **the item number as if it were the ref**.

> ### That is worse than the invention, not better.
>
> The invented ref was *not in the input*, so a downstream check catches it for free — and the
> grader now does. **`REF 250` is in the input.** Nothing structural refuses it, `click` would
> take it, and it opens Item 82.

## ⚠⚠ READ THIS BEFORE CELEBRATING THE 100%

> **Owner: 「An answer that is present, printed, and wrong passes every structural check we
> have.」**

Every defence built so far catches a ref that is **absent** from the input:

| defence | catches an invented ref | catches `REF 250` |
|---|---|---|
| the grader's 「never shown → never a pass」 | **yes** | **no** |
| the truncation notice | (was supposed to) | **no** |
| any downstream 「is this ref in the last read?」 check | **yes** | **no** |

**`REF 250` is a valid ref, printed on its own line, pointing at a real and clickable
element.** It fails only the one test nothing automated can run: *is it the element the
question was about?*

> ### So a 100% on this corpus does not mean 「she will not click the wrong thing」. It means the corpus asked one truncation question and got a good answer to it.

This is the single strongest argument for the **structural** fix over the declarative one: a
ref that cannot be a plain number cannot be answered with an item number. It is the only
defence in the table above that would have refused `REF 250`.

n=1, so it is not established as caused by the rewrite. **It is also exactly the kind of thing
「answer only with a ref printed above」 would push a model toward** when the printed thing it
is looking for is not there.

---

# THE RULING THIS SUPPORTS — and it is not 「build click」

**The number meets the bar. The confidence does not.**

1. **The corpus cannot measure this.** One truncation question, at a ~7% base rate, needs far
   more than 13 questions to separate a fix from luck. **The bar was met on a corpus too small
   to detect the defect the bar exists for.**
2. **The structural fix is still the answer.** An opaque ref — a deterministic hash of
   `backendDOMNodeId`, stable across reads, impossible to extrapolate — is a mechanism.
   The notice is a declaration, and this project's own rule is that declared fences degrade.
   **It would also have refused `REF 250`,** which the notice cannot.
3. **The notice rewrite is UNVALIDATED and its only signal is negative.** It is left in place
   rather than reverted only because the Owner has not ruled; the decision is his, and it is
   flagged rather than absorbed.

**Recorded as the condition for the NEXT corpus round** (not patched now, per the freeze rule):
real pages, captured **headed** — `DEFECT-009` shows the capture failure was bot mitigation,
not a broken network — and **more than one truncation question**, since that is the single
hazard this corpus tests with n=1.

## And the thing to say beside every number above

> **Five of six fixtures are mine. The score partly measures whether I guessed my own
> difficulty correctly, not whether `read_page` works on the web.** The one real page scored
> 4/4 — the real page was the easy one. Both readings of that are unflattering to the corpus,
> and the Owner has accepted them as the condition for the next round rather than a patch now.

---
---

# RUN 3 — 2026-08-06, opaque refs. **87.5% / 100%. BAR NOT MET.**

| | run 1 | run 2 | **run 3** | bar |
|---|---|---|---|---|
| targetsIdentified | 87.5% | 100% | **87.5% (7/8)** | 90% |
| absentTargetRefusals | 100% | 100% | **100% (5/5)** | 100% |

Cap `$2.50`, spent `$1.67`.

## What the structural fix bought — and it is exactly what it was built for

| failure class | before | now |
|---|---|---|
| `REF 634` — extrapolated to reach an unseen element | possible | **unreachable.** No sequence to extrapolate |
| `REF 250` — the item number answered as a ref | **passes every check we have** | **malformed.** Does not parse; `resolveRef` refuses it |
| `huge-list` truncation question | the original failure | **correctly refused** |

## ⚠ AND WHAT IT COST — measured, not suspected

The lost point: on `modal-over-content`, asked for the **`Continue` button**, the model
answered the ref of **`StaticText "Continue"`**. Same accessible name, different role, both
printed, three lines apart. Run 2 got this right with numeric refs.

**n=1 against n=1 is exactly what HR-14 forbids concluding from.** So it was A/B'd — same
question, same nodes, same session, interleaved, ten runs per arm, the *only* difference being
`[#12]` versus `[#r1d194297]`:

| | correct | picked the `StaticText` decoy |
|---|---|---|
| **NUMERIC refs** | **10/10** | 0 |
| **OPAQUE refs** | **8/10** | **2** |

> ## The opaque ref is 20 points worse at telling two same-named lines apart — on a NINE-LINE page.

Plausible mechanism: `[#12]` binds to its line at a glance; a nine-character hash makes the
ref↔line association real work, and the model sometimes carries back the neighbouring line
with the same name.

### This is a TRADE, and it is now measured rather than assumed

**Bought:** two failure classes that pass every other check, gone structurally.
**Paid:** a measurable loss of discriminability between similarly-named lines.

**It is not an argument to revert.** The two classes it kills are the ones nothing else
catches — `REF 250` was *present, printed and wrong*, and no absence check will ever see it.
A 20-point discriminability cost on a decoy pair is a different and more visible problem.

## THE REAL DEFECT THE A/B EXPOSED — and it is not the ref format

`StaticText "Continue"` **is the button's own label.** It is not a separate thing a person
could point at; it is the text *inside* the control on the line above.

> ### The pruner is emitting a decoy that the page does not actually contain.

So the candidate fix is not a different ref format — it is **dropping a `StaticText` whose
name exactly matches an interactive element's name**, because it duplicates that element the
way `InlineTextBox` duplicates `StaticText`. Look at the modal page: `Behind Modal`, `Close`
and `Continue` each appear **twice**, once as a control and once as its own label.

**NOT BUILT. It is another 「it should help」, and this round has already shown one of those
scoring worse in an A/B.** It is written down as the proposal it is, for the Owner to rule on,
with the measurement that motivates it attached — not applied because it sounds right.

## Cost so far, all caps held

| | |
|---|---|
| run 1 | `$2.05` of `$3.00` |
| run 2 | `$1.62` of `$3.00` |
| notice A/B | `$3.10` of `$3.50` |
| run 3 | `$1.67` of `$2.50` |
| ref-format A/B | `$2.25` of `$2.50` |
| **total** | **`$10.69`** |
