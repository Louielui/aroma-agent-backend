# House rules

<!-- record-status: ACTIVE 2026-08-06 -->

Rules the Owner has set that apply across the whole codebase, not to one feature. Each one
exists because something went wrong once; the story is kept because a rule without its
reason gets argued away.

---

## ⛔ READ THIS FIRST — it is the reason the rest of this file is not enough

> ### A CORRECT argument for an exception is worse than a careless one. It comes with its own
> ### justification attached, it survives review, and the next person reads it and agrees.
> ### The fence does not read the paragraph.

> ### 規矩①係「call site 用 literal key」，唔係「有人論證得到係安全嘅 key」——因為論證本身就係失敗模式。

**This applies far past literal keys.** Any rule in this document can be reasoned around, and the
better the reasoning, the more likely it is to succeed. That is what a mechanism is for: it holds
when the person breaking the rule is the one who wrote it, for a reason that is actually good.

> **Owner: 「Rules do not survive the moment they are inconvenient; the scan did.」**

One round before it happened, the Owner wrote:

> 「Literal keys only, enforced by a test that fails on a dynamic key. That is the one
> structural line that keeps data out of the translator, **and it will be tempting to break the
> first time something looks repetitive**.」

I wrote that rule down, wrote its test, wrote the paragraph explaining it — and then broke it, at
the first thing that looked repetitive, in the very next tranche. **The scan failed the build.
The warning did not prevent it.** Two more of the same temptation appeared in the same round.

### ⛔ AND THE FOURTH TIME WAS THE ONE THAT MATTERS

The first three were carelessness. The fourth was not: I reasoned my way in, **wrote the
reasoning down beside the code**, and the reasoning was CORRECT — the table held only literals
written in that file, nothing external could reach it, no data could enter the translator. Every
word of that was true. The scan refused it anyway, and the scan was right.

> ### 規矩①係「call site 用 literal key」，唔係「有人論證得到係安全嘅 key」——因為論證本身就係失敗模式。
>
> ### Rule ① is 「literal keys at call sites」, not 「keys someone can argue are safe」 — because
> ### the arguing IS the failure mode.

A correct argument for an exception is not weaker evidence than a careless one. It is stronger,
and that is what makes it worse: it comes with its own justification attached, it survives
review, and the next person reads the paragraph and agrees. The fence does not read the
paragraph.

**This document is a list of rules, and this is the evidence that a list of rules is not a
mechanism.** Every entry below is worth reading; none of them will stop anyone at the moment it
matters. What stops people is a check that runs. Where a rule here has no check, that is a gap,
not a preference — and where a check cannot be built, say so plainly rather than writing one that
merely looks like a guard (HR-48's corollary, and `src/i18n/catalogue.js` on plural agreement).

**Full entry: [HR-48](#hr-48--a-rule-you-were-warned-about-is-not-a-mechanism).**

---

## HR-1 — A card shows only what the decision needs

**Owner decision, 2026-08-03.**

> Default to showing only the information the Owner needs in order to decide.
> Everything else is collapsed.
> Before adding a section, ask: **would the Owner make a wrong decision without it?**
> If not, collapse it.

**What happened.** The Work Order approval card had eight sections — what changes, scope,
current content, intended content, worst case, what will not happen, caps, technical
details — to approve a one-line edit to a text file. The Owner had to read all of it to
find the three things he actually judges: *which file, what change, what is the worst
case.*

**Why it matters more than tidiness.** Every gate in this system assumes the Owner
understood what he approved. A card nobody finishes reading is an approval that is not
really being given — so an unreadable card is a governance failure, not a design blemish.

**How it is applied.**

- The visible face carries the decision. Nothing else.
- Everything removed from the face is **collapsed, never deleted.** Every promise the
  Owner relies on is still one click away and still travels in the same payload.
- The heading says what she **wants to do**, not what category of exercise it is
  (「香香想改一個檔案」, not 「香香想進行一項安全測試」). The Owner needs to know the
  request, not the machinery.
- **Say it once.** The heading already establishes that this has not happened yet, so the
  face does not additionally explain that an intention is not a result. Repeating a
  reassurance is how a page starts sounding anxious instead of clear.

**What this rule does NOT touch.** It is about presentation only. The approval mechanism —
Work Order, hash, nonce, TTL, typed `EXECUTE` — is unchanged by it, and no simplification
may ever remove a step the Owner has to take.

Enforced by `ownerDecisionCard.test.js` (face is exactly three facts; every collapsed
promise still asserted present).

---

## HR-2 — A placeholder is an instruction, never a plausible answer

An empty field whose ghost text looks like a valid value reads as filled. This cost two
attempts and burned a nonce once. Placeholders say what to type (`請輸入要改的檔案路徑`),
never an example of it (`docs/canary/agent-canary.md`).

Enforced by `demoRouter.test.js`.

---

## HR-3 — Never ask for what the Owner already said

If the request can be read from his own words, read it. Ask only for what is genuinely
missing, in one sentence, and **show what was inferred** so a wrong reading is visible and
correctable rather than silently assumed.

Enforced by `requestInference.test.js`.

---

## HR-4 — A guard must not read prose as behaviour

Source-scanning guards strip comments and string literals before matching. Three separate
guards in this codebase have failed on their own documentation or on a message written for
the Owner. The fix is always to make the guard precise — never to reword the code or the
comment that was telling the truth.

---

## HR-5 — Absent stays absent

Where something was not measured, not recorded or not attempted, say so. Do not fill the
gap with a default, an empty object, or a plausible value. `null` means unknown; `[]` means
measured-and-empty; they are different claims and must never be swapped.

---

## HR-6 — Assert the VALUE, not that the key was mentioned

A test that a field is *present* is not a test that the field *carries anything*. This one
looked like coverage and was not:

```js
// what it asserted — the route MENTIONS workOrderHash
assert.ok(/outcome: 'rejected'[^\n]*workOrderHash:/.test(ROUTER))
```

It passed for as long as the wiring existed. The wiring read
`loaded.record.workOrderHash` — a field the sealed record has never had, because the hash is
always computed — so every rejection was written to the durable audit trail with
`work_order_hash: null`, and the test agreed with it the whole time.

**It was caught by the Owner asking to look at a real record**, not by the suite. That is the
measure of the failure: the assertion could not tell a correct wiring from a permanently
null one, so it could only ever confirm what was already assumed.

**The rule.** Where a test can reach the value, assert the value. Where it can only read
source — as a structural test does — assert the *shape that produces* a value
(`workOrderHash: sealedHashOf(...)`), never the bare presence of the identifier. And prefer
one test that exercises the path over any number that read the file it lives in.

Sibling of HR-5: `null` and "a key exists" are different claims, and a test that conflates
them turns an unknown into a fact — which is the thing this project keeps finding.

---

## HR-7 — Correct server-side and absent to the Owner is a whole failure

A feature can be computed correctly, serialised correctly, and delivered correctly, and still
not exist. Nothing errors. Every test passes. The Owner sees no change and reasonably
concludes it was not built.

The deterministic work-order offer was measured firing on the exact message the Owner typed —
right file, right intent, attached to the response — and the client discarded it:

```js
if (res.demoOutcome === 'clarification') return renderProposal(...)   // returns first
if (res.workRequestOffer) return renderOffer(...)                     // dead code
```

**The branch that ate it was `clarification`, which is precisely the case the offer exists
for** — the model declining to produce a task. Placed after it, the offer could only ever
render on turns that did not need it.

**The rule.** A delivery path is part of the feature. "The server returns it" is not
evidence the Owner can see it, and neither is a green suite — every test here asserted the
server side. Where a change ends at a screen, verify at the screen, or say plainly that you
have not.

---

## HR-8 — Instrumentation does not travel to the thing built next to it

On 2026-08-05 the classifier was given `mode`, `clarificationReason` and `modeCoerced`
because a work-order failure could not be diagnosed from the log. Hours later, on the same
day, a NEW entry point to the same feature was built beside it **with no logging at all** —
so its first failure again had to be diagnosed by reasoning about code rather than reading a
line.

Then the fix for that logged nothing either, in a subtler way: the fields were added to the
allowlist and set on the telemetry object at line 364, while `emit()` writes the record at
line 260. Correct fields, correct names, written after the line they belong to. **The second
instance was inside the fix for the first.**

**The rule.** Instrumentation is not a property of a subsystem that neighbours inherit. When
building beside something that was just given visibility, ask what this new thing will look
like when it fails, and answer it before shipping — including WHEN the record is written, not
only what it contains. A field that is set after the log line is emitted is not
instrumentation; it is a variable.

---

## HR-9 — Absolute paths only; cwd is not a statement of intent

Three repos live on this machine and one of them is production:

| path | risk |
|---|---|
| `C:\Aroma\aroma-agent-backend` | local (this one) |
| `C:\Users\louis\Projects\aroma-system` | **PRODUCTION** — has `origin`, and its `main` is what `deploy.sh` resets the live system to |
| `C:\Aroma\aroma-3b` | local |

**The measured defect.** The session's primary working directory is the PRODUCTION repo, and
until 2026-08-05 `CLAUDE.md` existed only there. So an agent working on 香香 loaded
production's project instructions, and once proposed production files while working in this
repo. The cause was not carelessness about which repo was meant — it was that a relative path
resolves against a cwd nobody restated, and the wrong resolution looks exactly like the right
one.

**The rule.** Every file operation names an ABSOLUTE path. Never a bare relative path, never
`./`, never a path whose meaning depends on where the shell happens to be. Before writing,
confirm the absolute path is under the repo you intend.

**Why a rule at all, when the project's own principle is to prefer mechanisms.** Because this
one is only a guard rail. The mechanism is that an agent working on `aroma-system` works in a
clone with `origin` removed and delivers a patch — so a misdirected edit has nowhere to go.
See `AROMA-SYSTEM-WORKING-MODEL.md`. **HR-9 reduces the frequency; the no-remote clone removes
the consequence. Do not treat the rule as a substitute for the clone.**

---

## HR-10 — Record a distinction while it is still redundant

**Owner ruling, 2026-08-05:** 「The day it stops being redundant is the day nobody can
reconstruct which rows were which — that argument generalises and I want it recorded as
such, not as a note about this field.」

**The instance it came from.** The `basis` field in the DEFECT-001 fix says, per row, whether
a quantity can see inbound stock — `projected` or `current_stock`. Measured on the day it was
designed, `incoming_qty` was **0 on all 43 rows** that had projections, so both values produce
identical numbers and the field looks like decoration.

**The rule.** A distinction that is real but currently invisible in the data must still be
recorded, at the moment the record is written.

**Why, and this is the whole of it:** the day the two cases diverge is the day the distinction
starts to matter — and on that day **the history is already written without it**. Nobody can
go back and say which rows were which, because the only thing that knew is the code that ran
at the time. A field added later describes only the future; a field added now describes
everything from now on.

**The test to apply.** Not 「does this field tell me anything today?」 but:

> **「If these two cases diverge later, will anyone be able to tell them apart in what we have
> already stored?」**
>
> If the answer is no, the field is not redundant. It is early.

**Where else this bites, so it is not read as being about one column:** whether a number was
observed or attested by a worker; whether a deploy was signed by the Owner or executed by a
machine under his signature (`approvedBy` vs `actedAs` — the same argument, which is why one
overloaded `who` field is a defect and not a tidiness complaint); whether a read returned
nothing or was never performed.

**The counterweight, so this does not become a licence.** This is not an argument for
recording everything. It applies where the distinction is **real now and cheap now**, and
where reconstructing it later is **impossible** rather than merely tedious. If it can be
re-derived from what is already stored, it can wait.

---

## HR-11 — A command composed from a file is a hypothesis about a machine

**Owner, 2026-08-05:** 「I have been burned this week by commands that looked authoritative and
were composed from a file rather than from the machine.」

Reconstructing a command from `deploy.sh`, a config, or a doc produces something that **looks
exactly like a command someone verified on the machine**. The formatting is identical; the
confidence is not. This is the 「unknown answered as a fact」 failure wearing shell syntax.

**The rule.** When handing the Owner commands for a machine that has never been observed:

1. **Say so, unprompted**, in the same message as the commands — 「I have never seen that
   machine; every step is reconstructed from `deploy.sh` and CLAUDE.md」.
2. **One step at a time, each pasted back before the next is given.** Not a script to run
   start to finish.
3. **Name the specific unknowns rather than smoothing over them** — e.g. `scripts/deploy.sh`
   is not on `main`, so whether it exists in the VPS working copy is genuinely unknown, and
   that is discovered in step 1 rather than in the middle of step 3.
4. **Do not compose a command that needs a fact not yet in hand.** The `mysqldump` line waits
   until the machine has said how it authenticates, rather than being guessed at plausibly.

**Why paste-back is the mechanism and not the courtesy.** It converts each reconstructed
command into a verified one before the next depends on it. Without it, a single wrong
assumption in step 1 propagates silently through everything after it — and the output still
looks like a successful run.

---

## HR-12 — A check run on a filtered set cannot rule out what the filter removed

**2026-08-05. The sharpest error of the two days, and it was mine.**

`DEFECT-001` opened with this, presented as settled:

> 「Ruled out: 'they were already ordered' — **it is false, measured, not assumed**:
> `incoming_qty > 0` on **0 of the 43 returned rows**.」

The 43 were the rows that had passed `WHERE projected_qty < par_level` — that is, **precisely
the rows whose incoming stock did not cover the shortfall**. Every row that would have
answered 「yes, already ordered」 had been removed by the filter *before the check ran*. The
true answer, 18, was sitting in the excluded set, which is the only place it could ever have
been.

> ## The check was run on a sample the check itself had already filtered.

**And because that check appeared to eliminate the true cause, three false ones had to be
invented to explain what was left** — an INNER JOIN, a NULL comparison, and string coercion.
Each was plausible, each was written up with confidence, each was removed by one read-only
query. **One bad measurement cost three wrong diagnoses.**

### The rule

Before reporting that a hypothesis is ruled out, ask **where a positive result would have
appeared** — and check that the set actually examined includes that place. If the observed set
was produced by a filter, name the filter and ask whether it correlates with the hypothesis.
When it does, the check has no power at all: it is not weak evidence, it is **none**.

This is `probe_never_failed` (`DESIGN-WORKER-ADAPTER.md`) turned inside out. That rule says a
check that has never returned negative is not a check. This one says a check that **could not**
have returned positive is not a check either.

### And the label is part of the defect

「measured, not assumed」 is the exact phrase this project uses to mark a claim as trustworthy.
Attaching it to a structurally powerless check did more damage than the check itself — it
converted an open question into a closed one for two days. **Reserve the phrase for a
measurement whose failure mode you have identified**, and when using it, say what set was
examined and how that set was chosen.

### HR-12 addendum — the rule fired the day after it was written, in my own work

**Owner instruction: 「record 4a beside HR-12 … That is worth knowing about how a rule behaves
once it exists.」**

`count: 43` was diagnosed on 2026-08-05 and HR-12 was written the same evening. **The next
day, reviewing the other endpoints, `count: 50` from `/ai/daily-counts` was found sitting in
this project's own earlier measurement, recorded as a fact about how many stock-takes
exist.** It is the `LIMIT`. The set was silently truncated and the cap was reported as a
count.

**Same shape, one day later, with the lesson already written down.**

### What that says about rules

A written rule did not prevent the second instance, because **HR-12 was filed as a lesson
about a specific investigation** rather than as a thing to check. Nobody re-read it while
looking at a different endpoint.

**So a rule of this class is not finished when it is written.** It is finished when something
mechanical applies it:

| the rule | the mechanism that makes it fire |
|---|---|
| a check on a filtered set proves nothing | **`truncated`, computed** from `rows.length >= limit` in the response itself — the reader is told, and nobody has to remember |
| a declaration can go stale | **a boundary-case test** that fails when the predicate changes |

**A rule that relies on being remembered will be forgotten by the person who wrote it, within
a day.** That is not a criticism of the rule — it is the measurement of what rules are worth,
and the argument for spending the effort on the mechanism instead.

---

## HR-13 — Absence does not announce itself

**Owner instruction, 2026-08-06: 「Record the DID_NOT_RUN finding prominently.
『冇嗰一行本身就係訊號』 is the temporal version of count:43 and it will be forgotten
precisely because absence does not announce itself.」**

> ## The thing that did not run cannot write the row saying it did not run.

A scheduled task that never fires — process down, trigger disabled, machine asleep — leaves
**no record at all**. A screen reading its own table then shows the last successful run and
**looks calm**. Nothing is false on that screen. Everything on it is stale.

### Why this is the same defect as `count: 43`

| | the filtered answer | the absent answer |
|---|---|---|
| what happened | rows removed by a predicate | no row was ever written |
| what it looks like | a complete count | a healthy history |
| why nobody catches it | the response cannot say what it dropped | **there is no response to inspect** |

The second is worse: with `count: 43` there was at least an artefact to interrogate.

### The rule

**Whenever something is expected to happen on its own, store the expectation, not only the
result.** `nextRunAt` written on every run is what lets a reader compute
`now > nextRunAt + grace → DID_NOT_RUN`. Without it, a scheduler that silently stopped is
indistinguishable from one with nothing to report.

Generalised, because this is not only about schedulers:

> **A system that reports only what happened cannot report what failed to happen.
> Something must hold the expectation, and something must compare against it.**

Instances already live in this project:
- a scheduled run that never fires (this rule);
- a Drive folder that returns zero because it was never visible — 64 files reading as empty;
- a deploy whose safety tag was never pushed, so the rollback point's absence is invisible
  (`DEFECT-002`);
- a regression script that is missing, and the deploy exits `0` (`DEFECT-004`).

**All four are the same shape**: nothing went wrong loudly, so nothing was recorded, so the
record looks fine.

### And the reason this rule is written the way it is

**It will be forgotten.** HR-12 was written one evening and its own defect recurred the next
morning, in this project's own work, because a rule filed as a lesson is not a thing anyone
re-reads. So HR-13 is written with its mechanism attached rather than as advice:

> **The rule is not 「remember to check for absence」. The rule is 「store `nextRunAt`」** — a
> field, in a record, that makes the absence computable by something that is not a person
> remembering.

---

# HR-14 — A defect that survives a casual retest is worse than one that always fires

**Owner, 2026-08-06: 「A defect that survives a casual retest is worse than one that always
fires, because the retest is what most people would do.」**

The `read_page` benchmark caught a model answering with a ref that was not in its input. Run
the same question three more times and it answers correctly three times. **Roughly 1 in 4.**

> ## The retest is the trap. Not the bug.
>
> The reflex on seeing a strange result is 「run it again」 — and for a 1-in-4 defect the
> retest says *fine* three times out of four. **The behaviour that normally clears a false
> alarm is the behaviour that buries a real one.**

## The same shape already happened here

| | |
|---|---|
| the Drive backlog line | a 5-minute cache made a read that took 3.2–5.6s against a 2.5s budget **occasionally succeed**. The intermittency is why it was diagnosed as a stale tab first |
| the invented ref | 1 in 4 |
| the suite reporting `fail 4` once and `fail 3` on re-run | **and the fourth never named itself** |

## ⚠ WORKED EXAMPLE — this rule was broken by its own author, within the hour

**Not a separate note. It belongs here, because it is the strongest evidence the rule needs a
mechanism rather than a filing.**

Writing this page, I reported the invented ref as **「1 in 4」**. That came from **one event in
four attempts.** I then wrote, three paragraphs down, that a trial size must be set from the
observed rate — and had just set a rate from `n=4`.

**The A/B trial that followed put 14 old-notice attempts on record. The real figure is
1 in 14 ≈ 7%.**

| | |
|---|---|
| what I claimed | a 25% invention rate, stated as a finding |
| what the evidence supported | one event, in four |
| how much the number moved | **more than 3×**, and it was the number the whole fix was aimed at |

> ### And the consequence was not academic — it chose the wrong fix.
>
> A 25% rate reads as 「the notice is failing often」. A 7% rate reads as 「this barely
> reproduces, so a wording change cannot be evaluated by wording-change-sized trials」. **The
> first number justified rewriting the notice. The second says the rewrite was never
> measurable in the first place** — and the A/B then found the rewrite scored *worse*
> (9/10 against the old notice's 10/10) and introduced a new failure mode.

## ⚠ THE CONSEQUENCE, AS ITS OWN RULE

**Owner, 2026-08-06: 「a wrong rate does not just overstate confidence, it selects a fix for a
mechanism that was never operating.」**

> ### A WRONG RATE PICKS A WRONG FIX. That is a separate failure from being over-confident, and it is the more expensive one.
>
> Over-confidence costs you a caveat. **A wrong rate costs you the whole round** — the effort
> goes into a mechanism that was not the one failing, and the change ships looking reasonable
> because nothing contradicted it.

25% says 「the notice is too weak」 — a wording problem, so you rewrite wording. 7% says 「this
is a rare stochastic slip」 — which no wording change was ever going to move, and which points
instead at the *format* the model was reasoning over. **The eventual fix was structural
(opaque refs). The number is what delayed getting there.**

**So the rate is not a headline figure attached to a finding. It is the input that selects
what you build**, and it must be treated with the seriousness of a design decision rather than
the looseness of a summary statistic.

**Owner: 「You broke HR-14 in the hour you wrote it, and you caught it yourself. That is the
strongest evidence yet for HR-13's point — a rule filed as a lesson does not get re-read,
including by its author.」**

## THE MECHANISM, not the advice

HR-13's lesson applies to this rule too, and the worked example above is the proof: a rule
filed as advice is not re-read, **including by the person who just wrote it.** So:

> ### A fix for an intermittent defect is not evaluated by running it once. The trial size is set from the OBSERVED RATE, before the fix is written.
>
> **And a rate is not a rate at n=4.** One event in four attempts is one event; it licenses a
> trial, not a number. A ~7% defect needs tens of runs per arm to separate 「fixed」 from
> 「lucky」. **One green run after a change is 0/1, and 0/1 is not evidence.**

And where the fix is a change of wording, prompt, or model input, **the trial is A/B against
the unchanged version in the same session** — otherwise the comparison is confounded by the
model's own drift, which is HR-12 in a new place.

---

# HR-15 — A grader that has never been checked against a result you disbelieve is HR-12 in the measuring instrument

**Owner, 2026-08-06: 「Both grader bugs were found by distrusting a result, not by the grader
failing. Write that where the next benchmark gets built.」**

The first benchmark run had two grader bugs. **Neither announced itself.** Both surfaced only
because a result looked wrong and got read:

| bug | what it did | how it was found |
|---|---|---|
| accepted **any** `REF n` on one question | **scored the invented answer PASS** — the benchmark built to catch invention was blind on the one question where invention happened | the number looked too clean for a truncated page |
| answer key matched `/password/i` against every name | marked a **CORRECT** model answer FAIL — it hit `link "Forgot password"` before `textbox "Password"` | the failure named an element that was obviously the right one |

**A grader is code that reports a number and never reports its own wrongness.** A wrong test
fails loudly. A wrong grader produces a plausible percentage.

## The mechanisms

1. **Derive the answer key from the RAW input, never from the output being graded.** Bug 1
   existed because the key was computed from the pruner's output — so it drifted toward the
   pruner. **The key must not depend on the thing under test.**
2. **Freeze the key in a file before the run.** A key computed at run time can be edited by
   the same reasoning that produced the code.
3. **A pass must be positively earned.** 「Not obviously wrong」 is not a pass. Bug 2 was a
   branch that accepted anything of the right *shape*.
4. **Read at least one PASS and one FAIL by hand every run.** Both bugs were within one
   minute's reading. Nobody reads the passes.

## ⚠ THE COROLLARY — assert the INVARIANT, not the scenario

**2026-08-06.** The group budgeter emitted `group "Panorama…" — 0 of 1 shown` on a real
capture: a **bare header** — the exact thing its own header rule forbids, a claim that
something exists with no way to reach it. The fit probe said one member would fit; the loop
then took none.

**Every unit test was green.** They used synthetic groups, whose arithmetic never reaches that
state. **It was found by reading real output.**

> ### The fix was not a test for that case. It was a SWEEP asserting the property.
>
> `maxChars ∈ [80…600] × maxNodes ∈ [1…9]` — 48 combinations — asserting **every emitted group
> has at least one member**, rather than pinning the one budget that happened to break.

**A scenario test proves a case; an invariant sweep proves a property.** Where a defect came
out of arithmetic you did not anticipate, testing the case you just found is testing your
imagination a second time — the same failure as writing a `StaticText` rule for what turned
out to include `image + link`.

---

# HR-16 — Our own transformation can MANUFACTURE an ambiguity the source does not have

**Owner, 2026-08-06: 「the pruner can manufacture a distractor that does not exist on the
page. That is not a browser problem or a model problem — it is our own transformation
inventing an ambiguity, and it will happen again in shapes that are not StaticText.」**

## What happened

`read_page` asked for the `Continue` button and got the ref of `StaticText "Continue"`.
**Both lines were real, both were printed, and only one was a thing a person could click.**

But `StaticText "Continue"` **is the button's own label** — the text *inside* the control on
the line above. On the page there is ONE Continue. In our output there are two.

> ### The model did not hallucinate. It chose between two options WE created.

## The class, named — **NAME ECHO**

> **A node that carries the same accessible name as another node because the accessibility
> tree exposes both a control and the content that renders inside it.**
>
> The echo is not a target. It is a projection of the target, and printing it as a peer makes
> it look like a choice.

**It is not about `StaticText`.** Measured across the corpus — 1724 surviving nodes,
**584 of them (34%) sit in a name group that mixes an interactive node with a non-interactive
one**:

| role combination | groups | note |
|---|---|---|
| `StaticText + link` | **558** | the dominant case — a link's own text |
| `StaticText + button` | 9 | |
| `StaticText + button + link` | 7 | |
| **`image + link`** | **4** | **not `StaticText` at all** — the logo image inside the logo link, same accessible name |
| `StaticText + textbox` | 2 | a form label beside its field |
| `StaticText + heading` | 6 | **neither is interactive**, so it is redundancy rather than a *choice* between clickable and not — out of scope for the fix, in scope for the rule |

**The Owner's prediction was correct before the fix was written: `image + link` is the same
defect in a shape nobody would have grepped for.**

## THE RULE

> ### Every transformation that DROPS nodes must be checked for what it makes AMBIGUOUS, not only for what it removes.
>
> A pruner is judged on what survives. **The failure here was in the relationship between
> survivors** — two rows that are one thing — and no test of the form 「is X still present?」
> can see it.

## The mechanism, not the advice

**A duplicate-name audit across the corpus, run as a measurement and not as a review.** The
number above (34%) came from twenty lines of script, and it found a class the author had not
considered. If a transformation is added or changed, that audit is re-run and the new
combination list is compared — because a new role pairing appearing is exactly how this
recurs in a shape nobody grepped for.

**And it is a family, not an incident:**
- the pruner inventing a second `Continue` (this rule);
- `count: 43` — a filter producing a set whose shape matched the claim (HR-12);
- an invoice list flattening per-line rows into something the page read as invoices.

**All three are our own transformation changing the meaning of the data while preserving every
individual value.**

## The three findings the Owner ruled worth keeping from this round

### 1. `image + link` is what makes NAME ECHO a principle rather than a StaticText rule

**Owner: 「I would have accepted a StaticText fix and been wrong.」**

The bug presented as `StaticText "Continue"` beside `button "Continue"`, and the obvious fix is
a rule about `StaticText`. The corpus audit found **five role combinations** and 34% of
surviving nodes in mixed groups — **including `image + link`**, the logo image inside the logo
link, which no `StaticText` rule would ever have touched.

> **The measurement is what turned a fix into a principle.** Had the audit not been run, the
> rule would have been written in terms of the symptom, passed its tests, and left the same
> defect live in a shape nobody would grep for.

**So the prune keys on INTERACTIVITY, not on a role name** — the property that actually
defines the class.

### 2. ⛔ AN INTERACTIVE NODE IS NEVER PRUNED. This line will be tempting to cross.

**Owner: 「two real Add buttons are the page's own ambiguity, and hiding one is the pruner
lying. That line will be tempting to cross when the 21-button problem gets hard.」**

The temptation is concrete and it is coming: the live Costco page has **21 buttons all named
`Add to Cart`**, and the cheapest way to make that output look clean is to emit one.

> ### That is not simplification. It is the pruner reporting a page that does not exist.
>
> A manufactured duplicate (the echo) is OURS to remove. A real duplicate is the PAGE'S, and
> removing it is the same class of error as `count: 43` — a transformation that changes the
> meaning while every surviving value stays true.

**The rule: ambiguity that exists on the page must reach the model as ambiguity.** The fix for
21 identical buttons is to give them *distinguishing context*, never to give them *fewer
entries*.

### 3. A measurement instrument found a bug the feature tests could not — for the second time this round

**Owner: 「That is the second time this round a measurement instrument found something the
feature tests could not.」**

| | what it found | what the feature tests said |
|---|---|---|
| the benchmark grader | the model answering a ref that was not in its input | all green |
| the A/B seam test | `candidates.length = 0` emptying the array the unpruned branch had **aliased** — every node vanished | all green |

The second one is a real bug in shipped-that-hour code, and **the only reason it was reachable
was that a measurement needed the feature turned off.** Nothing in the product ever calls that
path.

> ### Building the instrument exercised the code in a way using the code does not.
>
> This is not an argument for more unit tests. It is an argument that **an A/B seam, a grader,
> or an audit script is itself a test of a kind the suite does not contain** — and that when
> one is built, its findings about our own code are worth as much as its findings about the
> subject.

---

# HR-17 — Build the measurement tool. It tests the code in a way using the code cannot.

**Owner, 2026-08-06: 「the bug was reachable only because a measurement required the feature
switched off, so nothing in the product had ever run that path. That is an argument for
building measurement tools that is independent of what they measure.」**

## What happened

The name-echo prune shipped green. To A/B it, the pruner needed an off switch — one code path,
measured against its own absence, rather than two copies of the pruner that would measure the
difference between the copies.

The moment that seam existed, a test of it failed:

```js
const deduped = opts.dropNameEchoes === false ? candidates : candidates.filter(...)
candidates.length = 0            // <-- empties the array `deduped` is ALIASING
candidates.push(...deduped)      // <-- pushes nothing. Every node gone.
```

**A real bug, in code written that hour, that the whole suite passed over** — because nothing
in the product ever takes that branch.

## ⚠ WORKED EXAMPLE — HR-17 failed in the session it was written, and that is what the rule became

**Owner, 2026-08-06: 「the rule is not 『build measurement tools』, it is 『a seam must be proven
to isolate one thing, and the proof is not that you intended it to』.」**

Hours after writing this rule I built a seam, `opts.group === false`, to A/B grouping. **It did
not isolate grouping.**

Ambiguity is **DEFINED** as 「a duplicate with no resolving container」. Turning grouping off
skipped the resolution, so every duplicate became unresolvable, and the arm labelled **FLAT**
carried 「⚠ indistinguishable from N others — **do NOT choose between them**」 on **32 nodes**.

> ### The baseline arm was actively instructing the model not to answer.
>
> It failed three role-ambiguity questions it had passed **3/3** hours earlier, and three
> numbers in the comparison were unreadable — not because measuring was hard, but because
> **the seam moved two things while its name said one.**

**And the first fix did not finish the job.** Flagging was keyed by NAME while resolution is by
NODE, so a name with some resolvable instances still diverged: **153 flagged in the flat arm
against 134 in the grouped arm, on the same page.** A seam bug with a seam bug inside it.

### THE RULE, RESTATED

> ## A seam must be PROVEN to isolate one thing. The proof is not that you intended it to.

The proof is a test, and it is cheap: **run both arms at an unbounded budget and assert that
everything except the one intended difference is identical** — same nodes, same flags, same
warnings. That test now exists for three real pages, and it would have caught this on the day.

**This is the second rule this week broken in the hour it was written** (HR-14 was the first).
Not carelessness twice — it is the evidence for HR-13's mechanism, **a rule filed as a lesson
does not get re-read, including by its author**, and it is why each of these now carries a
mechanism instead of advice.

## THE RULE

> ### A measurement tool is a test of a kind the suite does not contain, and its findings about our own code count as much as its findings about the subject.

**And the argument does not depend on what is being measured.** The A/B was built to answer a
question about a *model's* behaviour. It found a defect in *ours*. That is not luck:

- an A/B needs the feature **off**, so it runs a path the product never runs;
- a grader needs **ground truth derived independently**, so it contradicts the implementation
  rather than agreeing with it;
- an audit script needs to **enumerate**, so it sees classes a hand-written test enumerated by
  imagination (`image + link`, which no `StaticText` rule would have caught).

**This round produced three findings by these three routes, and zero by the feature tests.**

## The mechanism

**When a change is worth A/B-ing, build the seam as a seam in ONE code path** — never a second
copy — **and test the seam itself.** The duplicate-copy version of this A/B would have passed
happily while measuring nothing, because both copies would have been correct *separately*.

**And a seam is not a feature flag.** It defaults to the safe value, a test asserts that
default, nothing in the runtime passes it, and its comment says it exists for measurement.

---

# HR-18 — Measure the BASELINE before designing for a limitation. A right answer to an unchecked question is the most expensive failure shape.

**2026-08-06. The headline finding of the browser round — recorded above the seam bug, at the
Owner's instruction, because it cost more.**

## What happened

I wrote that the flat `read_page` output gives a model 「**no containing product, no position,
no grouping**」 to tell 21 identical `Add to Cart` buttons apart. It was recorded as a
limitation and acted on: a design round, a measured containment study, a new frozen corpus,
per-group truncation, an A/B.

**The output was emitted in document order the whole time.** The product link sits on the line
immediately above its own button. **「我對住一個按文件次序輸出嘅嘢，寫咗『冇位置』。」**

Measured: **flat scores 100% on the very questions the round existed to make answerable**, and
grouping costs **31 points** elsewhere.

## ⚠ WHY THIS IS WORSE THAN A WRONG ANSWER

**The fix WORKED. 4/4.**

> ### With a clean measurement we would have shipped a working fix, for a problem that did not exist, at 31 points of cost — and the 100% would have read as proof.

The only reason anyone looked was a contaminated A/B arm producing a gap that needed
explaining. **A correct measurement of a correct fix would have closed the case.**

> **Owner: 「not a wrong answer, a right answer to a question nobody checked.」**

## Why the other rules do not cover it

| rule | guards | why it missed |
|---|---|---|
| HR-12 | a measurement whose filter matches the claim | **there was no measurement** — the premise was asserted |
| HR-15 | a grader nobody checked | the grader was correct |
| HR-17 | a seam that moves two things | the seam accident *exposed* this; it did not cause it |

**Every A/B compared two treatments. None asked whether the baseline already solved the
problem — because the premise said it could not.**

> ### We validate FIXES exhaustively and PREMISES not at all.

## THE MECHANISM — two parts, both cheap

**1. Before building for a limitation of our own output, PRINT THE OUTPUT AND READ IT.** Not
re-derive it, not reason about what the code should emit — read the bytes a model receives.
**The disproof here was four lines of text and cost nothing**, and it was available before the
design document, before the corpus round, before roughly `$13` of trials.

**2. Every problem statement gets a BASELINE MEASUREMENT before it gets a design.** The V3
questions could have been written and run against flat output on day one; they would have
scored 100% and the round would never have begun.

> **A question with no gradeable answer today is a reason to MEASURE the baseline, not a
> reason to assume it fails.** That assumption is what 「this cannot be tested against current
> output」 quietly becomes.

---

# HR-19 — The convenience flag that returns success and does nothing. It will appear again.

**Owner, 2026-08-06: 「A library flag that returns success while doing nothing is the exact
failure shape we have spent a week removing, and it arrived as a convenience. Note that it
will appear again — every browser library has one, and the next person will find the same flag
and the same reason to use it.」**

## Measured, twice, in two different verbs

| call | result |
|---|---|
| `click(covered, { force: true })` | **returns success. The button is never clicked** — the overlay eats the event |
| `fill(readonly, { force: true })` | **returns success. The field still reads `"read only"`** |

**No error. No exception. No warning.** In both cases the very next line of our code would
have written 「clicked」 or 「typed」 into the audit record, truthfully reporting a call that
returned normally and did nothing.

## Why it exists, and why that is the danger

`force` skips actionability. It exists because the checks are sometimes wrong — a element that
is technically covered by a transparent overlay a user can click through, a field a framework
marks readonly while accepting input. **Those are real cases, and that is exactly why someone
will reach for it.**

> ### The flag is not a bug. It is a documented escape hatch from the checks that make every refusal in this system trustworthy.
>
> And the moment it is used, **every refusal we report becomes unreliable**, because the
> reader cannot tell which calls were checked.

## THE MECHANISM

> ## Structurally absent, not discouraged. Passing it THROWS.

Like `headless` in `launch.js`: not a validated option with a warning, **no parameter to set.**
`click.js` and `type.js` each throw on `'force' in target`, and a test asserts it.

## ⚠ AND IT WILL APPEAR AGAIN — this is the part to keep

Every browser automation library has this flag, under some name: `force`, `noWaitAfter`,
`dispatchEvent`, `evaluate(el => el.click())`. **The next person will meet a page where a
correct refusal is inconvenient, will find the flag, and will have a genuinely good reason.**

So the rule is not 「do not use `force`」 — that is advice, and advice loses to a deadline.

> ### The rule is: any option that SKIPS A CHECK must be absent from our surface, and the reason must be recorded where the person reaching for it will read it.
>
> That reason, in one line: **it returns success while doing nothing, and we measured it in
> two separate verbs on the same afternoon.**

---

# HR-20 — Freeze the acceptance BEFORE the build. Seventeen green unit tests and a live run that returned UNKNOWN three times.

**Owner, 2026-08-06: 「The two acceptance catches are the argument for freezing acceptance
before the build, and I want them stated that way. Not 『acceptance is good practice』.」**

`ACCEPTANCE-CLICK.json` was frozen before `click.js` existed. Its bar demanded **「C1–C9 green
as tests, PLUS a live headed probe showing covered / moving / disabled REFUSED WITH A STATED
REASON」**. That second clause looked redundant when it was written. It caught two defects that
the tests could not.

## Catch 1 — a safeguard that could never fire

`REFUSAL.UNSTABLE` was **unreachable in production.** The in-page probe returned a hardcoded
`stable: true`; its unit test passed because the fake returned `false`.

**A branch that reads as a safety check and can never trigger** — the thing this project
refused to stub in `DESIGN-DISPATCH-PATH` for exactly this reason — **inside the file whose
purpose is explaining why a click was refused.**

## Catch 2 — seventeen green tests, three UNKNOWNs

The live run then came back:

```
REFUSED  REFUSED_REASON_UNKNOWN   disabled
REFUSED  REFUSED_REASON_UNKNOWN   moving
REFUSED  REFUSED_REASON_UNKNOWN   covered
```

**All 17 unit tests were green.** The probe was passed to `page.evaluate` as a **string**, and
the real `page.evaluate` does not bind arguments to a string. **The fake accepted what the real
thing rejects.**

> ## The feature was, in the only way that matters, entirely broken — and every test agreed it worked.

## THE RULE

> ### Acceptance is frozen before the build, and it names a check the unit tests structurally cannot perform.
>
> Usually that means **one live run against the real dependency.** Not because live tests are
> better, but because a fake is written by the same person, at the same time, with the same
> assumptions — and it will agree with them.

**Frozen before** matters as much as **live**: an acceptance bar written after the build is a
description of what was built. This one was written from a measured baseline, before a line of
the implementation existed, and it demanded something inconvenient — which is why it was still
demanding it when the implementation turned out to be wrong.

## ⚠ HR-18, SECOND INSTANCE — one level up. An assertion about how the WORLD behaves is a premise too.

**Owner, 2026-08-06: 「the second HR-18 instance one level up: first our own output, now the
web itself… An assertion about how the world behaves is a premise too, and two getFullAXTree
calls would have disproved it at any point this week.」**

| instance | the premise | the disproof |
|---|---|---|
| **first** | 「the flat output gives a model **no position**」 — about **our own output**, which is emitted in document order | **four lines of text** nobody printed |
| **second** | 「a ref taken before an action still resolves after it」 — about **the web** | **two `getFullAXTree` calls** |

## The second one, measured

`link "Jump to content"` on en.wikipedia.org, same page, no navigation, before and after
clicking Search:

```
backendDOMNodeId before   8001
backendDOMNodeId after   20437
anchors with that text after   1     <- it is still on the page
the original id       "Node with given id does not belong to the document"
```

> ## `backendDOMNodeId` is stable for a NODE. A NODE is not stable for a PAGE.

The skin re-rendered its header. Same link, same role, same accessible name — **different DOM
node.** React, Vue and Vector all replace element objects on re-render as a matter of course,
so this is not a Wikipedia quirk and no care on our side can make the premise true.

## WHY THE SECOND KIND IS HARDER TO CATCH

A premise about **our own output** is disprovable by printing it. A premise about **the world**
feels like knowledge — 「a DOM node has a stable identity」 is the kind of thing one simply
knows, and knowing it is exactly what stops anyone measuring it.

> ### The rule extends: 「measure the baseline」 includes measuring the WORLD the baseline sits in, and the tell is the same — a sentence stating how something behaves, with no measurement beside it.

**Both were cheap. Neither was run.** The cost of the first was a whole design round; the cost
of the second was an acceptance criterion frozen around a falsehood — and only caught because
the criterion was tested live rather than assumed.

## And the fix rejected TWICE for the same reason

When a ref goes stale, the tempting repair is to re-find the element by role + accessible name.

| when it was tempting | why it was refused |
|---|---|
| `REF 250` — the model answered an item number, present and printed and wrong | nothing structural refuses an answer that *looks* right |
| the stale ref here — the new node has the same role and the same name, in the same place | 「the element that looks like the one you meant」 |

> **Same defect, two coats.** It would have made the criterion pass on that page and clicked
> the wrong thing on any page where two nodes share a name. **The refusal is correct; the
> caller re-reads.**

## ⚠ HR-18, THE STRONGEST CASE FOR IT — a guardrail from a baseline met its first real case within a day

**Owner, 2026-08-06: 「A guardrail you added from a baseline measurement, unprompted, meeting
its first real case within a day — that is the strongest argument yet for measuring before
designing, and it is worth stating beside HR-18 rather than only in the errand log.」**

## The sequence, with dates that are hours apart

| | |
|---|---|
| **the measurement** | baselining `type` produced the only honest way to state the difference between the verbs: **「`click` moves a mouse; `type` puts CONTENT into a page」** |
| **the guardrail** | from that sentence alone — `input[type=password]` and credential-shaped accessible names are **REFUSED, not redacted**, and the audit record is built **without the typed value from the start** rather than stripped on the way out |
| **who asked for it** | **nobody.** No ruling, no requirement, no review comment |
| **its first real case** | **less than a day later, on the Owner's own login form** — `textbox "Email"`, `textbox "Password"`, `button "Sign in"` — reached by an errand that had nothing to do with credentials |

> ### Had the errand been written to 「just log in」, `type` would have refused before touching the field.
>
> **The fence was there before the case arrived, and that is the only order that counts.** A
> guardrail added after the first incident is a patch; the same guardrail added before it is a
> property.

## Why this argues for HR-18 specifically, and not merely for caution

The refusal did not come from imagining what could go wrong. **It came from writing down what
was measured, and then reading the sentence honestly.** Baselining `type` was done to find out
what the library already handled — a cost-saving exercise — and the governance requirement fell
out of it as a by-product of describing the verb accurately.

> **Measuring before designing does not only tell you what NOT to build. It tells you what the
> thing you are building actually IS** — and 「a verb that puts content into a page」 has
> obligations that 「a verb that types」 does not.

**Advice would not have produced this.** 「Be careful with credentials」 is agreeable and
inert. The measurement produced a sentence, and the sentence produced a fence.

---

# HR-21 — The browser is for systems WITHOUT an API. Pointing it at one we own is the hardest mechanism against the easiest problem.

**Owner ruling, 2026-08-06.**

ERRAND-002 pointed the six verbs at `aroma-system`, which the Owner owns, and hit a login wall
in 1.8 seconds. **That system has `/api/v1` with Bearer tokens, and 香香 already holds a scoped
read-only key for it.**

> ## Reading pending invoices through the API needs no browser at all: no accessibility tree, no refs, no staleness, no clicking, no re-read after every action. One request, one JSON body.

| | use the API | use the browser |
|---|---|---|
| a system we own, or any system with an API | ✅ | ❌ **hardest mechanism, easiest problem** |
| a supplier portal, a vendor order form, Canva, a site with no programmatic surface | — | ✅ **this is what it is for** |

**The rule is a routing decision, made before the work starts:** *does this destination have a
programmatic surface?* If yes, the browser is the wrong tool and choosing it adds every
failure mode of the six verbs — staleness, truncation, re-render, bot mitigation — **in
exchange for nothing.**

And it cuts the other way too: **the browser's value is exactly proportional to the absence of
an API.** Its hardest cases — defended retail, framework re-renders, login walls — are the
cases where no easier mechanism exists, which is why it is worth having and why it will always
look inefficient next to a system that could have been queried directly.

## ⚠ HR-15, THE SAME FAMILY ONE LEVEL OUT — declaring your own contamination BEFORE the measurement, not after

**Owner, 2026-08-06: 「You saw the labels before writing the exclusions, and you said so before
measuring the holdout rather than after. That is the discipline that made the number worth
anything — record it beside HR-15, since it is the same family as a grader that agrees with its
author.」**

## What happened

Measuring L1 required hand-labelling a corpus, which required **listing the element names** —
so `AGREE & PROCEED`, `Next`, `Buy` and `Add to cart` were in front of me **before** I wrote
the exclusions that exempt exactly those four.

The recogniser then scored **11/11 and 0 false positives** on that corpus.

> ### That 100% was fitting, and saying so afterwards would have been worthless.

**It was declared before the held-out capture existed, and the recogniser was committed
unchanged first**, so the second number — **45%** — is verifiably a measurement against a
frozen rule set rather than a claim about one.

## Why the ORDER is the whole rule

| when the contamination is declared | what the number is worth |
|---|---|
| **before** the held-out set is captured | a real measurement, because the author has bound himself in advance |
| **after** the held-out number is known | **nothing.** It reads as an explanation for a disappointing result, and it is indistinguishable from one |

**HR-15 says a grader nobody checked is HR-12 in the measuring instrument.** This is the same
family with the instrument being the *author*:

> ## A measurement whose designer has seen the answers is fitted, and the only thing that recovers it is DECLARING IT WHILE THE OUTCOME IS STILL UNKNOWN.

**The mechanism:** when a corpus must be inspected in order to be labelled, say so in the
record **at labelling time**, freeze and commit the thing being measured before capturing the
held-out set, and treat the fitted score as **a description of the corpus, never as a
capability**.

**And the practical tell:** if a fitted score and a held-out score are far apart, the fitted one
was never a finding. **100% and 45% is one result, not two.**

---

# HR-22 — A probe that checks the name you would first think of reports UNSAFE as SAFE. And this one was caught by luck as much as by discipline.

**Owner, 2026-08-06: 「The lockfile name is the finding of this round and I want it recorded as
such, not as a Windows footnote… It caught it because you listed both names, and that was luck
as much as discipline. Say so.」**

## What happened

The profile-lock probe looks for Chrome's single-instance lock. **The name I would reach for
is `SingletonLock`** — it is the one in every Chromium discussion, every bug report, every
answer online.

**On Windows the file is `lockfile`.** `SingletonLock` is the POSIX name and **does not exist
on this machine.**

| what a probe checking only `SingletonLock` would report | what was true |
|---|---|
| `FREE` — the profile is idle, go ahead | **a live Chrome session holding the profile** |

> ## Unsafe, while reading safe. **That is the exact shape 「seen to fail」 exists to catch — and it would have PASSED a seen-to-fail test**, because the fake lock in the test would have been created under whichever name the test author also thought of.

**The demonstration and the defect would have shared an assumption.** A probe and its own
failure-demonstration written by the same person, on the same afternoon, from the same mental
model, are not independent.

## ⚠ AND IT WAS CAUGHT BY LUCK AS MUCH AS BY DISCIPLINE

**I did not reason that Windows differs.** I wrote a *list* — `SingletonLock`, `SingletonCookie`,
`SingletonSocket`, `lockfile` — because listing plausible names is a habit, not because I knew
the fourth was the one that mattered here.

> ## A habit that happens to cover a hole is not knowledge of the hole.
>
> Had I written the one name I was confident about, the probe would have shipped reporting
> `FREE` on locked profiles, and the live run would have agreed with it.

### And the sharper form of it, which is this week's whole pattern

> **Owner: 「『見過失敗』 is not independent evidence when the failure is staged by the same
> mind that wrote the check.」**

**A demonstration written by the author of the check shares the author's assumptions.** The
fake lock in a seen-to-fail test would have been created under whichever name the test author
also thought of — so the check and its proof would have agreed, and the agreement would have
looked like evidence.

**Seen-to-fail is necessary and it is not sufficient.** What makes it evidence is that the
failure is staged by something the author did not choose: **a real page, a real platform, or a
second person.** Here it was a real Windows Chrome, which had never read the documentation
either of us learned from.

## THE RULE

> ### Where a probe keys on a NAME the platform chose, the first name you think of is the name from the platform you learned on. Enumerate the alternatives, and prefer a check that does not depend on the name at all.

Three mechanisms, in order of strength:

1. **Do not key on the name.** Ask the system the question directly — *is this profile in use?* —
   by attempting the thing that would fail. **The strongest check here turned out to be exactly
   that**: a second `launchPersistentContext` is refused in 0.3s with a clear message, and it
   depends on no filename at all.
2. **If you must key on a name, enumerate every platform's** and record why each is in the list.
3. **Verify the demonstration is independent of the implementation** — if the same person picks
   both the check and the way it is made to fail, the failure demonstration proves the two
   agree, not that the check is right.

**HR-15 said a grader that agrees with its author proves nothing. This is the same defect in a
probe, and the shared assumption was not a value — it was a filename.**

---

# HR-23 — A guardrail that cannot read its own evidence is not clean, it is BLIND

**Owner, 2026-08-06: 「The three-state result and the UNREADABLE ruling are right. A guardrail
that cannot read its own evidence is not clean, it is blind.」**

The payment probe returns **three** states where two would have been natural:

| state | claim |
|---|---|
| `CLEAN` | **we looked at five tables and they are empty** |
| `NO_DATABASE_YET` | **Chrome has never written here** — nothing has been stored, which is not the same as having checked |
| `UNREADABLE` | **we could not look** → `clean = false`, and the session refuses to start |

> ## A binary `clean: true/false` forces 「I could not read the evidence」 into one of two answers, and the one it lands on is 「fine」.

**That is `count: 43` in a fence**: a value that is technically true (no findings were returned)
standing in for a claim that was never established (there are none). HR-5 — *absent stays
absent* — applied to the thing that is supposed to be doing the protecting.

**The rule generalises past probes:** any check that gates an action reports **at least three**
outcomes — *passed*, *failed*, and **could not be evaluated** — and the third is treated as
failure. **A gate that cannot tell 「I checked and it is fine」 from 「I could not check」 is a
gate that opens when it breaks.**

---

# HR-24 — A frequency claim is a MEASUREMENT. Once it is repeated back to you, it stops being a claim.

**Owner, 2026-08-06: 「that describes every wrong premise this week, and it is the only one
where the mechanism is stated.」**

> ## 一個未經量度嘅講法，一旦俾你覆述返，就唔再似一個講法，而係似共同知識。

**This rule lives here, in the file read before a finding is written — not only in the report
of the one incident that produced it.**

## The worked example, in three steps

| | |
|---|---|
| **1. I wrote it** | 「it has been silently present in **every page we have measured**」 — I had measured **one page** and generalised |
| **2. He repeated it back** | the next instruction came in his own words: 「it has been silently present in every page we have measured」 |
| **3. It was carrying a decision** | cited as part of why the fix was worth doing |

**The truth: 3 of 26 pages. 36 of 36,669 surviving nodes — 0.1%.**

## Why it is worse than an ordinary error

**Nothing caught it.** No test failed, no probe fired, no reviewer objected. **It surfaced only
because the fix required measuring the thing properly**, and the real number happened to
contradict a claim I had already made.

> ### At the moment it is repeated back, it stops being *my* claim and becomes *our* shared knowledge — and from then on it justifies work, shapes priorities, and the next person to doubt it must argue against both of us.

## And the specific reason a frequency claim slips through

**HR-18 says a premise needs a measurement.** A frequency claim evades that rule because
**「it is everywhere」 sounds like an observation, not an assertion** — it has the grammar of
something someone noticed rather than something someone computed.

| what was claimed | what it would have justified |
|---|---|
| 「it is everywhere」 | a large change, urgently |
| **「it is rare and lands badly」** (the truth) | **a small change, carefully** — which is what was built |

**Both arguments support the same fix. Only one of them is true**, and the false one would have
supported far more than the evidence does.

## THE MECHANISM

> ### Any sentence containing 「every」, 「always」, 「most」, 「usually」, 「rarely」 or a percentage is a MEASUREMENT CLAIM. Either a number is beside it, or the word is deleted.

**And when the Owner repeats one back:** that is the moment to check it, **not the moment to
feel confirmed.** A claim returning in his words is the last point at which it is still cheap
to correct — after that it is load-bearing.

---

# HR-25 — Write policy, read evidence. Never both on one key.

**Owner, 2026-08-06: 「a guardrail that overwrites the key its own probe reads would have
reported clean forever, and nothing else would ever have said otherwise.」**

> ## 寫政策，讀證據 —— 同一個 key 上面永遠唔會兩樣都做。

## What was about to happen

`writeProfileDefaults` set `account_info = []` — and `probeBrowserSignIn` **reads
`account_info`** to decide whether Chrome is signed into a Google account.

Written once at creation, that was harmless. **Re-asserted before every launch — which is the
fix the Owner had just approved — it becomes:**

```
launch:  write account_info = []      (wipes the evidence)
         probe account_info           (finds nothing)
         report: signIn BLOCKED, clean
```

> ### A genuinely signed-in Chrome would have been erased from the record and then reported clean, forever, by design.

**Nothing else in the system would ever have contradicted it.** No test, no second probe, no
live behaviour — because the state the probe existed to detect was destroyed by the fence one
line earlier.

## Why it is a general rule and not a bug report

Every guardrail that both **enforces** and **verifies** has this shape available to it. The
tell is a single key appearing on both sides:

| the fence writes | the probe reads | verdict |
|---|---|---|
| `autofill.credit_card_enabled = false` | `autofill.credit_card_enabled` | **fine** — this is *policy*, and re-asserting it is the point |
| `account_info = []` | `account_info` | ⛔ **catastrophic** — this is *evidence*, and re-asserting it is a lie |

**The distinction is not the key, it is what the key MEANS:**

> ### POLICY is what we intend. EVIDENCE is what happened. Re-asserting policy is a fence; re-asserting evidence is forgery.

**The mechanism:** before writing anything into a store a probe reads, ask 「if this value is
wrong, do I want to overwrite it or to be told about it?」 **Overwrite policy. Be told about
evidence.**

## ⚠ AND NO TEST CAUGHT IT

**Owner: 「the only reason it did not ship that way is that you noticed while wiring it. Say
so; that was not caught by a test either.」**

Every unit test passed — **including the two that prove the sign-in probe catches a signed-in
Chrome** — because those tests wrote the account themselves *after* the defaults had been
written. **The fake never met the fence.**

It was caught by **reading the two functions side by side** while wiring a third thing, and
noticing they touched one key from opposite directions.

| the last four defects of this family | caught by |
|---|---|
| the unmounted enquiry router | a live 404 |
| Chrome sign-in missing from the defaults | the Owner, reading the design against the report |
| L1 and L3 wired to nothing | the Owner, saying 「check, do not recall」 |
| **the fence erasing its own evidence** | **reading two functions side by side** |

> ### Four of a kind. **None caught by the suite.** Wiring smoke tests now cover the third. **Nothing covers the fourth**, and the honest reason is that I do not know what shape that test has — a test that asserts 「no writer touches a key any reader depends on」 is a static-analysis question, not an assertion.

---

# HR-26 — 「Logged in」 is not one state

**2026-08-06, measured on Costco Business Centre with the Owner's own session.**

> ## 登咗入唔係一個狀態。

The profile's cookies were enough for the site to **personalise the homepage** — it showed
`link "Orders"`, the account nav, the member greeting. **The same cookies were not enough to
open the orders page**, which redirected to a full sign-in form with a password field.

| state | what it looks like |
|---|---|
| **recognised** | the homepage knows who you are, shows your nav, your name, your saved lists |
| **authenticated** | the account area will actually serve your data |

**Cookies present ≠ signed in.** And the failure lands **at the useful page, not the front
page** — which is the worst place for it, because every check short of the real target says
everything is fine.

## What follows for every future errand

1. **Never conclude 「signed in」 from the landing page.** The nav saying `Orders` is a claim
   about the *menu*, not about the *session*.
2. **The check is the destination.** An errand that needs account data is only proven to work
   when it has read account data — not when it recognised a greeting.
3. **Report which one you observed.** 「LOOKS SIGNED IN」 must never be written as 「signed in」;
   the errand log now distinguishes them.

---

# HR-27 — A state that is unreachable in production, but renders as a calm sentence, is worse than an error

> ## 個 state 令個 bug 睇落似資訊。

**Owner, 2026-08-07: 「A state that is unreachable in production but produces a calm,
grammatical, timestamped sentence is worse than an error — it is a defect wearing the shape of
an answer.」 Recorded beside `count: 43`, which is the same shape one layer down.**

## What happened

`NOT_CHECKED` existed for the Drive section. The reader was never wired, so it fired — and
rendered:

```
我未睇過 Drive。          00:27
```

**Grammatical. Calm. Timestamped. Entirely wrong.**

> ### Had the state not existed, an unwired reader would have thrown, or produced a missing section, or crashed — something visibly broken. Instead it produced a sentence the Owner had no reason to distrust.

**Second instance the same week:** an absent `Preferences` file reported 「搵唔到個 profile 嘅
設定檔」 when the truth was 「Chrome is holding it」 — **a correct refusal with a wrong reason.**

## Why it is worse than an error

| | |
|---|---|
| an error | **announces itself.** Someone investigates within minutes |
| a calm, wrong sentence | **is read, believed, and repeated** — and by HR-24 it becomes load-bearing the moment it is repeated back |

**An error costs an hour. A plausible sentence costs however long it takes for reality to
contradict it** — and 「64 files, 53 days」 vs 「我未睇過」 only contradicted because the Owner
happened to remember yesterday.

## THE RULE

> ### Every state a section can report must be reachable ONLY by something that actually happened. A state that a MISSING WIRE can produce must name itself a defect, not a condition.

Three mechanisms, applied here:

1. **`NOT_WIRED` is its own state, for every section**, and its text says 「呢個係一個缺陷,唔係
   一個狀態」. It never falls through to the empty-for-a-reason line.
2. **A missing dependency is distinguished from a failing one.** `store.list()` on an absent
   store threw a `TypeError` that the same `catch` reported as `CANNOT_READ` — a wiring bug
   dressed as a data problem. Now they are separate states.
3. **The wiring smoke test asserts the state is not `NOT_WIRED`** — a value only a real read
   can produce, rather than merely 「a state exists」.

---

# ⚠ HR-24, SECOND WORKED EXAMPLE — a claim repeated back became load-bearing within ONE round

**Owner, 2026-08-07: 「I wrote that the fifth had not happened based on your report. That is
HR-24 again — a claim I repeated back became load-bearing within one round.」**

| | |
|---|---|
| **I wrote it** | 「the fifth thing wired to nothing did not happen」 — in the commit for the 首頁 server half |
| **He repeated it back** | 「yesterday found four things wired to nothing and I am not adding a fifth」 |
| **It was false when I wrote it** | the Drive reader was already unwired in the same commit |
| **Time to load-bearing** | **one round** |

## What makes this instance sharper than the first

The PUA frequency claim took a day and a measurement to disprove. **This one was false at the
moment of writing**, and I wrote it **in the same commit that contained the counter-example** —
`mountHomeRoutes` was called without a `backlogReader` four lines below the sentence claiming
nothing was unwired.

> ### And my own wiring smoke test agreed with me. It asserted the section had a `state` and a `checkedAt`; `NOT_CHECKED` has both.

**HR-6 — assert the VALUE, not that the key was mentioned — failed inside a test written to
catch exactly this class.** That is the part worth carrying: **a test can be about the right
thing and still assert the wrong property**, and the wrong property is almost always 「it
exists」 rather than 「it is right」.

---

# HR-28 — A layout decision nobody made. 「Drive 排第一，係因為佢先存在。」

**Owner, 2026-08-07: 「That is worth naming as its own shape: a layout decision nobody made,
that would have been defended if I had not asked, because the thing that exists first looks
like the thing that belongs first.」**

## What happened

首頁 rendered **Drive → errands → waiting**. The Drive line is **four lines tall and changes
once a day**; 「等你決定」 is **one line and is the only thing with a deadline**.

**There was no reason for that order.** Drive went first because it was the section that
already existed — it had been attached to the greeting for weeks. **Sequence of construction
became sequence of importance, and nobody decided it.**

> ### And I would have defended it. Asked 「why is Drive first?」 I could have produced 「context before decisions」 in one sentence — a reason invented after the fact, for an arrangement that had none.

## Why this shape is worth its own rule

A wrong decision leaves an argument behind: someone weighed it, and the reasoning can be found
and re-examined. **A non-decision leaves nothing** — and the empty space fills with
justification the moment it is questioned.

| | |
|---|---|
| a decision | has a reason. The reason can be wrong, and can be checked |
| **a non-decision** | **acquires a reason only when challenged** — and that reason is generated to defend it, not to explain it |

**This is HR-18's family** — a premise nobody measured — **applied to arrangement instead of
fact.** Both are 「something that was never established behaving as though it had been」.

## THE MECHANISM

> ### For any ordering, ask: **would this be the order if the pieces had been built in the opposite sequence?** If the honest answer is no, the order is construction history, not design.

**And the corrective is a principle already in the system**, not a new opinion. Here the
briefing *already* had one — **only items with a deadline persist above the thread** — and the
order simply was not following the rule the same surface used for persistence.

> **The fix was not 「pick a better order」. It was 「apply the rule that was already there」.**

## The sentence that resolved it

> ## 首頁 shows waiting FIRST; the bar is the briefing's STAND-IN when the briefing is gone.

**One sentence deciding both the order and the gating** — and the gating half exposed a
duplication neither of us had seen: the bar was not gated at all, so on the empty screen a
waiting item rendered **twice**, a collapsed count at the top and the useful card at the
bottom. **Nothing had stopped yet, so it had never been visible** — and the first day something
stopped would have been the moment of least patience with it.

---

# HR-29 — Do not borrow a credential for a page that does not ask for one

**Round:** the errand runner, 2026-08-07. **Owner: 「the recall errand not reaching for the
credential profile, and the reason」.**

She now has a logged-in Chrome profile, built deliberately, ACL'd, out of the repo and out of
offsite backup. **The Owner's own framing: 「The profile folder is a credential. Treat it as
one from day one.」**

The moment a session runner exists, it becomes the obvious thing to call — and the first errand
wired through it was ERRAND-003, the **public** recall register. No login. No account. Nothing
the profile contributes.

## The two costs, and the second one is the one that gets missed

| | |
|---|---|
| **Exposure** | a credential is carried onto a page that never needed it. Prompt injection while wearing his identity is **unmitigated** — so every page she visits while holding it is a page that can try |
| **⛔ Availability** | `openBrowserSession` refuses to open when the profile lock is held. **His own Chrome being open would fail the errand** — and the failure would read as 「blocked」, on a site that was never blocking anything |

The second is the one that would have shipped quietly. It is not a security cost, it is a
**reliability cost paid for a security asset that was doing no work**, and it only shows up on
the days he happens to be browsing.

## THE RULE

> ### Reach for a credential when the page demands one, never because the runner that holds it is the convenient one.
> The default for a public read is a **fresh ephemeral browser**. It carries nothing, so it can
> leak nothing and cannot be locked out.

**And the fence is structural, not declared** — the test greps the errand's own source for
`profileDir` and `browser-profile` and fails if either appears. Not 「remember not to」.

---

# HR-30 — Ask what a REFUSED record degrades INTO. A guard's fallback is a claim of its own.

**Round:** the errand runner, 2026-08-07. **Owner: 「a stop report that cannot be assembled
becomes BLOCKED_BY_SITE, which would tell me the site blocked her when she actually stopped
for me.」**

`errandStore` correctly **refuses** a `STOPPED_FOR_YOU` row with no stop report — an
Owner-approved rule, because a stop he cannot act on is not a stop. `runErrand` correctly
**does not drop** a refused row, because an errand that ran and left no trace is
indistinguishable from one that never ran.

Both rules are right. **Composed, they silently convert 「she stopped for you」 into 「the site
blocked her」.**

| what happened | what he would read | what he would do |
|---|---|---|
| she reached a control she would not press, and is standing at it | 「個站攔住佢」 | nothing — sites block things, that is normal |

A cart sits half-built at a checkout page and the briefing files it under **weather**.

## Why no test caught it and no review would have

Both components were tested **in isolation and were correct in isolation.** The store's
refusal test passes. The runner's never-lose-a-row test passes. **The defect lives in the
seam**, and the seam is where each component is doing exactly its job.

## THE RULE

> ### Every guard has a fallback. Name the sentence the fallback produces, and check it is not a DIFFERENT TRUE-SOUNDING CLAIM.
> A refusal that degrades to an error is honest. A refusal that degrades to **another
> outcome the system also uses for real events** is a forgery, and it will be believed.

**The mechanism:** the errand builds the stop **complete, at the point of the stop**, where all
five fields are in hand — never assembled later from what survived. And the test round-trips it
through the **real store**, not a fake. A fake store accepts whatever it is handed, which is
precisely the assumption the defect was made of.

**This is HR-6's family** (assert the VALUE, not that the key was mentioned) **arriving at the
level of composition:** it is not enough for each component to be right — the sentence the
composition produces is itself a claim, and nobody had read it.

---

# HR-31 — When told to delete a guarantee, look for the version that KEEPS it

**Round:** the errand runner, 2026-08-07.

> **Owner: 「delete the assertion, not the folder.」**
> **Owner, after: 「Your fix is better than what I asked for and I want the reason recorded…
> next time I may be wrong in the same direction.」**

Three tests asserted `C:\Aroma\ComputerOperator-Test` does **not exist**, meaning **「this code
created nothing」**. Absence was a PROXY for the claim. An Owner-approved canary then created
the folder, the proxy went false, and the claim never did.

The Owner ruled out the destructive fix immediately and correctly — **deleting live evidence so
a test goes green is not a fix.** His remaining instruction was to delete the assertion.

## Why deleting it would have cost something real

| | |
|---|---|
| delete the folder | ⛔ destroys the evidence the test protects |
| delete the assertion | tests pass, and **the guarantee is gone** — nothing then checks that Phase 1 / 3a create nothing |
| **snapshot and compare** | ✅ tests the claim itself, **and is strictly stronger than the original** |

> ## 「唔存在」 can never catch WRITING INTO a folder that already exists.
> The original assertion had a blind spot from the day it was written, and the blind spot only
> became reachable once the folder existed. Snapshot-and-compare closes it.

So the stale assertion was not merely stale — **it was the weaker of two available checks the
whole time**, and the canary is what made the difference observable.

## THE RULE

> ### An instruction to remove a check is an instruction to solve the problem the check has become. It is not always an instruction to lose the check.
> Before deleting, ask: **is there a formulation that asserts the CLAIM instead of the PROXY?**
> If yes, that version usually also covers a case the original never did — because the proxy was
> chosen for convenience, and convenience is where blind spots live.

**And the direction matters.** The Owner was right about the destructive half (do not touch the
folder) and under-reaching on the constructive half. **That is the safe direction to be wrong
in** — and it is why the constructive half is worth checking rather than executing. He asked
for this to be recorded precisely because he expects to be wrong in the same direction again.

**Structural, not remembered:** `rootUntouched.helper.js` is the only place the comparison
lives, so the next inertness test inherits the stronger form by default rather than by
recalling this entry.

**Seen to fail before trusted:** `absent` / `dir:0` / `dir:1[a.txt]` all distinguished. A probe
that has never failed is not evidence.

---

# HR-32 — Whatever renders a state must be printed across ALL its states and read as a set, before it ships

> **Owner: 「Add the mechanism rather than the lesson — whatever renders a state should be
> printed across all its states and read as a set, before it ships.」**

## THE MECHANISM

> ### Find every surface that maps a state onto an output — a sentence, a colour, an icon, an
> ### exit code. Enumerate the states. Render all of them into ONE block. Read it as a set.
> ### Any two states producing the same output is a defect, and the pairs to check first are
> ### the ones a reader would ACT on differently.
>
> Then write the assertion as **`notStrictEqual(render(A), render(B))`** — not as two separate
> tests that each render one state correctly. **Sameness is a property of a PAIR, and a suite
> that only ever looks at one state at a time cannot see it.**

Add it to the definition of done for any state-rendering surface, beside the integration test.
It costs one `console.log` loop and it is the only thing that finds this class.

---

**Round:** the scheduler, 2026-08-07. **What the mechanism caught the day it was written:**

> **Owner: 「Your DUE wording change is the part I would forget to check. After it goes live,
> tell me what the DUE line actually says in both states — I want to read the scheduled version
> before I rely on it, not after a scheduler has been dead for three days.」**

Printing all five DUE branches side by side immediately exposed one that no test had asked
about:

| witness | what it rendered | what it means |
|---|---|---|
| `NOT_INSTALLED` | 「仲係手動行嘅,冇人行就冇新嘅。」 | nothing was ever set up — **calm, correct** |
| `DISABLED` | 「仲係手動行嘅,冇人行就冇新嘅。」 | **a schedule EXISTS and somebody switched it off** |

Both have `scheduled: false` — correctly, since a disabled task cannot fire — so both fell into
the same branch. **The quietest failure mode in the whole design was wearing the calmest
sentence in it.** He would read 「手動」, conclude nothing is wired, and never look at the task.

## Why the suite was no help

Every test passed. The tests asserted the states the branches were WRITTEN for; nothing asked
what two different inputs LOOKED LIKE next to each other. **A test proves a branch behaves as
specified. Only reading proves the specification says different things about different worlds.**

## THE RULE

> ### For any surface that renders a sentence per state, print EVERY state's sentence in one
> ### block and read them together, before it ships. Two different facts that produce the same
> ### sentence is a defect, and it is invisible one test at a time.

**Mechanism:** the pairs worth checking are the ones a reader would act on differently. Here:
*absent vs disabled*, *never-ran vs unreadable*, *manual vs trigger-never-fired*. Each pair now
has a test asserting the sentences DIFFER — not just that each is individually correct.

**And it generalises past sentences.** Any mapping from many states onto fewer outputs — colours,
icons, exit codes — can collapse two meanings into one. The same round produced a second
instance at the exit-code level: `ok` required every errand to answer, so one throttled
ingredient (measured: one in six on a normal day) would have painted the Windows task red every
morning until 「the task is failing」 meant nothing. **HR-27's family — a defect wearing the
shape of an answer — but arriving through COLLAPSE rather than through a wrong value.**

---

# HR-33 — Ask what a NORMAL day looks like, not what a failure looks like

**Round:** the scheduler, 2026-08-07.

> **Owner: 「note that you found it by asking what a normal day looks like rather than what a
> failure looks like. That question is doing a lot of work and it is not written down anywhere.」**

## THE MECHANISM

> ### For any signal — a colour, a sentence, an exit code, an alert — do not ask 「is it correct
> ### when things go wrong?」 Ask: **「what does this show on an ordinary Tuesday, and will he
> ### still be reading it in a month?」**

A signal is only worth its correctness if it is still being read. **Correct-and-ignored is
indistinguishable from absent**, and it arrives silently: nothing fails, the tests stay green,
and the person just stops looking.

## Three instances in eight days, all the same shape

| where | what the failure-first question said | what the normal-day question said |
|---|---|---|
| the `DUE` line's colour | red = overdue, correct | **every kind is DUE most days when nothing is scheduled.** Red daily → skipped within a week |
| the scheduled task's exit code | any errand not answering = failure, correct | **one ingredient in six gets throttled on a normal day.** Red every morning → 「the task is failing」 means nothing |
| the `NEVER_RUN` line | it says a true thing | it is the only one that has **never been true before**, so it is the one that earns the ink |

The first two were caught only by measuring an ordinary run. **Both were correct.** Correctness
was never the property at risk.

## Why it is not the same as 「don't be noisy」

Noise is a volume problem and can be tuned. **This is a semantics problem:** the signal is
spending its meaning on the common case, so it has none left for the rare one. The fix is never
「show it less」 — it is to make the common case say something ordinary in ordinary words, so the
uncommon case has somewhere to stand out FROM. HR-32's disabled-vs-absent pair is the same
budget viewed the other way round.

**Where it goes:** beside HR-32 in the definition of done. HR-32 asks 「do two states say the
same thing?」 This asks 「which state is TODAY, and what does that do to the others?」

---

# HR-34 — Pace, do not retry. A read-only errand that retries harder is not read-only in any sense the site cares about

**Round:** the scheduler, 2026-08-07.

> **Owner: 「A read-only errand that retries harder against a site already struggling is not
> read-only in any sense that matters to the site.」**

Measured: six recall searches back-to-back **broke the register**. The first real scheduled run
answered 2 of 6 — the third timed out on the search button, and 4 through 6 could not navigate
at all. Paced five seconds apart: **6 of 6 in 42 seconds.**

## Why the reflex is wrong

The obvious fix for a timeout is a retry, and it is the wrong one here:

> ## 「Read-only」 is a claim about the DATA. It is not a claim about the LOAD.
> A site cannot see that our requests are harmless. It sees a client that got slower responses
> and answered by sending more. From the other end, a well-behaved reader and a small denial of
> service differ only in intent — and intent is not observable.

Every fence in this system is structural for exactly this reason: what a thing IS, not what it
means. **This is that principle pointed outward** — at the load we place on someone else, on a
public register we have no right to strain, from a task that runs unattended every morning.

## THE RULE

> ### When an unattended read starts failing, slow down. Do not retry, and never retry faster.
> A retry loop is the one shape that converts a transient failure into a sustained one.

**And the schedule is what makes it non-negotiable.** A hand-run that hammers a site is a
mistake someone is watching; the same loop on a timer runs every morning, forever, with nobody
present. `PAUSE_BETWEEN_MS` in `recallRunner.js` carries this reasoning at the constant.

**Also honest about the cost:** pacing means the errand takes ~70s instead of ~40s, and that
one ingredient may still fail on a bad day. That is recorded as `BLOCKED_BY_SITE` and reported —
a worse-but-honest result, chosen over a better-looking one obtained by pushing harder.

---

# HR-35 — Report what the source returned. A second filter on top of a search is invisible, and its failure mode is silence.

**Round:** the scheduler, 2026-08-07.

> **Owner: 「個站搵到,我掉咗」 is the shape that must never ship into something that runs every
> morning and says 「冇嘢」. A false all-clear on a recall is the one case where the cost is not
> my time. Noise is fine; I will read six lines and dismiss four. Silence I cannot audit.」**

The recall errand searched the register, then kept only results whose TITLE contained the query
word. It looked like precision. It was **a second, undeclared filter stacked on the site's own
search** — and the site had already decided relevance.

So a romaine recall the register returned under the title 「Certain Caesar Salad Kits recalled
due to E. coli」 was **dropped**, and the errand answered 「冇搵到相關回收」.

## Why this class is worse than an ordinary bug

| | |
|---|---|
| a wrong answer | visible; he checks it and finds it wrong |
| **a filtered-away answer** | **renders as good news, is indistinguishable from a genuine all-clear, and nothing in the output hints that a filter ran** |

And on a **daily unattended task** nobody would notice for months, because the output would be
correct-looking every single morning.

## THE RULE

> ### When something else has already selected for you — a search, an API query, a filter you
> ### passed in — REPORT WHAT IT RETURNED. Do not re-select. If the result set is too big, cap
> ### the number SHOWN and state the total; never narrow the set by your own criteria.
>
> Corollaries, both from the Owner:
> 1. **Keep the source's ORDER.** Re-ranking by your own relevance guess is the same filter one
>    step later. (Sorting by date is not exempt — it is still our judgement replacing theirs.)
> 2. **Say FOUND vs SHOWN.** 「89 條,顯示頭 6」 is a different fact from 「6 條」, and only one
>    of them lets him notice that a search returned forty.

## ⛔ THE WORKED EXAMPLE — KEPT SO NOBODY LATER 「IMPROVES」 THIS BACK INTO A FILTER

Searching **「green onion」** returns **「Old Dutch Ridgies Sour Cream, Green Onion & Bacon Flavour
Potato Chips」**. A FLAVOUR NAME, not an ingredient. Useless to a chef.

**It stays.** It is precisely the false positive the Owner said he would accept, and the
asymmetry is the entire argument:

> a false positive costs two seconds of reading · **a false negative costs a recalled product
> going out on a plate**

Any change that makes the potato chips disappear will also make some Caesar salad kit disappear,
and **only one of those is visible from the outside.** The chips are the price of the salad kit.

## And the guard that has to come with it

Removing the filter creates a new way to be silent: if the site restructures its markup, the
extractor recognises nothing and 「no rows parsed」 would render as 「no recalls」. So:

> ### 「I recognised nothing」 must never be reported as 「there is nothing」.

The site states its own total (「Displaying 1 - 15 of 89 items.」). Total > 0 with zero rows
parsed is a **contradiction**, and the only honest reading of a contradiction is 「my parser is
broken」 — never 「你冇事」. No total AND no rows AND no explicit 「no results」 claims neither.

**This is HR-30's family** — asking what a failure DEGRADES INTO — applied to the absence of
data rather than the absence of a record.

---

# HR-36 — The first-run state is the one nobody tests, and it is the first thing he sees

**Round:** the scheduler, 2026-08-07.

> **Owner: 「a sentinel read as a failure code, in the first sentence I would have seen after
> approving. Same family as case D — correct branches, wrong reading of a value that only
> appears in the state nobody tests.」**

A freshly registered Windows task reports `LastTaskResult = 267011` and
`LastRunTime = 1999-11-30`. That is `SCHED_S_TASK_HAS_NOT_RUN` and Windows' never-ran sentinel:
**the task is perfectly healthy and has simply not fired yet.**

The witness tested `code === 0`. So, seconds after a clean install:

> 「上次行嗰次 Windows 報失敗,退出碼 267011(0x41303)。⚠ 0x1 通常係排程 logon 睇唔到 user
> profile 入面嘅檔案 —— 備份 task 就係咁死過。」

**Every clause of that is wrong**, and it would have been the first sentence he read after
approving the install — the exact moment he is deciding whether to trust the thing.

## Two compounding errors, and the second is the more common one

1. **A sentinel read as a value.** `267011` is not an exit code; the whole `0x41300` family are
   statuses. Some mean trouble (`TERMINATED`, `NO_VALID_TRIGGERS`) and some do not
   (`HAS_NOT_RUN`, `RUNNING`, `READY`). **「≠ 0」 collapses all of them into 「failed」.**
2. **A hint attached to the wrong scope.** The `0x1` profile-visibility note is real and
   valuable — it is the measured trap that killed the backup tasks — but it was printed for
   ANY non-zero code, so it would have sent him hunting a cause that did not apply.

## THE RULE

> ### For anything with a lifecycle, write down what it reports in its FIRST state — before it
> ### has ever run, before it has any history — and check that sentence specifically. It is the
> ### state with no test data, it happens exactly once, and it is the state the person is in
> ### when they are deciding whether to trust the thing.

**And the general form:** an external system's status field is a VOCABULARY, not a number line.
Look up what the values mean before comparing them to zero. `0` meaning success does not imply
every other value means failure.

**Family:** HR-32 (two states rendering the same sentence) and this (one state rendering the
wrong sentence) are both **correct branches, wrong reading of the input**. HR-32's mechanism —
print every state and read them as a set — would have caught this one too, if the first-run
state had been in the set. It was not, because nothing had ever produced it.

---

# HR-37 — A deliverable written for a human must be exercised in the place they will open it

**Round:** the scheduler, 2026-08-07.

> **Owner: 「you were right about the BOM. That is why Show returned nothing and I had nothing
> to attach. A script written for me to read failed to parse in the shell I would read it in,
> and neither of us saw it until it ran.」**

`aroma-errand-task.ps1` was written to be READ — the whole point of it was 「an auditable script
in the repo, not a schtasks line nobody can find again」. It was carefully commented, it was
committed, it was offered to the Owner with a `-Action Show` command.

**It could not be parsed at all.** Written as UTF-8 without a BOM, PowerShell 5.1 read it as
ANSI, the first Chinese string became an unterminated literal, and EVERY action — including
`Show` — died with a parser error. The Owner ran it, got nothing, and had nothing to attach.

## Why nothing caught it

| | |
|---|---|
| the suite | greps the file as TEXT for the task name — passes on a file PowerShell cannot parse |
| review | it reads correctly in every editor; the defect is in the encoding, which is invisible |
| **the author** | **never once ran it** — it was going to be run under the Owner's GO |

The one thing that would have caught it is the one thing not done: **executing the read-only
action.** `-Action Show` changes nothing. There was never a reason not to run it.

## THE RULE

> ### If you hand someone an artifact to open — a script, an export, a config, a report — OPEN
> ### IT YOURSELF, in the tool they will open it in, before handing it over. Not the source: the
> ### artifact, in its destination.
>
> And when the artifact has a read-only mode, **that mode is free to run and there is never a
> reason to skip it.** Waiting for approval is a reason not to INSTALL. It is not a reason not
> to `Show`.

**The specific trap, recorded so it is not rediscovered:** PowerShell 5.1 requires a **UTF-8
BOM** to read a UTF-8 file correctly. Any `.ps1` in this repo containing 中文 or ⛔ must be
saved with one, or it fails at parse time — not at the line with the character.

---

# HR-38 — 「行咗」 and 「喺啱嘅地方行咗」 are different things

**Round:** the backup repair, 2026-08-07. **HR-37 failed in the hour it was written.**

> **Owner: 「you ran two read-only checks and both were run in the wrong environment, one of
> them against a header that warned about exactly that. 「行咗」 and 「喺啱嘅地方行咗」 being
> different things is HR-37 failing in the hour it was written — that is now the third rule
> this week to do that.」**

Minutes after recording HR-37 — *「open it yourself, in the tool they will open it in」* — I ran
two read-only checks and got two answers that were not answers:

| check | what I did | what came back | the truth |
|---|---|---|---|
| `auditWiring.js` | ran it in MY shell | `not_authorized` | in the launcher env: **`agent_bridge_authorized`** |
| `verifyHybridPersona.js` | ran it in MY shell | `CONFIG_ERROR` | `AROMA_CORE_DIR` is set **nowhere at all** |

The first is the sharper one. **The probe's own header warns about this in its opening
paragraph** — 「is the store wired in the REAL assembly, with the REAL launcher environment — as
opposed to appearing wired when app.js is read?」 I ran the probe and skipped the sentence
explaining what running it means.

## Why this keeps happening

Running a check produces OUTPUT, and output feels like an answer. **The feeling of having
checked is delivered by execution, not by validity** — so the incentive to verify the
environment disappears at exactly the moment the result appears.

## THE RULE

> ### Before believing a check's result, state where it ran and why that is the place the
> ### answer is about. If you cannot name the difference between that environment and the real
> ### one, you have not run the check — you have run something with the same filename.

**Mechanism:** for anything environment-sensitive, print the environment WITH the result. A
probe that reports `AGENT_BRIDGE=off` next to its verdict makes a wrong-environment run
self-evident; one that reports only the verdict makes it invisible. `auditWiring.js` already
does this — it prints the flags — **and I still did not read them.** So: the check must be
compared against the launcher's own values, not merely displayed.

**Third rule this week to fail in the hour it was written** — after HR-27 (a defect wearing the
shape of an answer, which then happened inside the test written to catch it) and HR-32
(two states rendering one sentence, whose own first-run state was the thing it missed).
The pattern is not carelessness; **it is that a rule about noticing cannot be applied by the
same attention it is trying to correct.** Every one of these was caught by a MECHANISM or by
the Owner, never by resolving to be careful.

---

# HR-39 — A gate that cannot run until the thing it gates is approved is not a gate

**Round:** the backup repair, 2026-08-07.

> **Owner: 「the gate scripts held hostage by the decision they exist to inform is its own
> shape. Name it. A measurement that cannot run until the thing it measures is approved is not
> a gate, it is a formality waiting to be skipped.」**

`scripts/computer/verify-session-gate.ps1` exists to answer ONE question with evidence — does
the scheduled task run in the same interactive session as the Companion — and its own header
says 「if it does not, STOP」. It is **read-only**. It has never been run, because Computer
Operator is held pending an EXECUTE GO.

**It is the measurement that GO is supposed to be based on.** Same for `tierA-probe.ps1`, the
containment measurement, and `computerSupervisor.dryRun()`, which has never been run against a
real work order.

## What the inversion does

A gate held until after approval has only two possible fates, and both are bad:

| | |
|---|---|
| it is run after the GO | it can no longer stop anything — the decision is made, the momentum is committed, and a FAIL now costs more than it saves |
| it is skipped | **more likely**, because by then the thing works, and running a gate that could only produce bad news is nobody's instinct |

Either way the gate never gated. **It became a formality the moment its result stopped being
able to change the decision.**

## THE RULE

> ### A gate must be runnable BEFORE the decision it informs, and its cost must be low enough
> ### that running it early is free. If a measurement requires the approval it exists to
> ### inform, it is mis-sequenced — fix the sequence, do not schedule the measurement later.
>
> Test to apply when writing one: **「what does this measurement cost, and what is stopping me
> from running it right now?」** If the honest answer is 「a decision that this measurement is
> supposed to inform」, the gate is upside down.

**Distinguish the legitimate case.** Some measurements genuinely cannot precede the thing —
`verify-session-gate.ps1` needs the AromaOperator account to exist and be signed in. That is a
real prerequisite, not a decision. **The test is whether the blocker is a FACT or a CHOICE.**
Waiting on a fact is sequencing. Waiting on the choice you are meant to inform is inversion.

**Its sibling is HR-37's second half:** waiting for approval is a reason not to INSTALL. It is
not a reason not to `Show`, not to `-DryRun`, and not to measure.

---

# HR-40 — A specification and its violation, same codebase, same author, same week

> ### ⛔ THIS RULE LIVES AT THE POINT OF AUTHORSHIP, NOT HERE.
> **Owner: 「Keep it where a design gets written, not where a defect gets recorded.」**
> The operative form is  — read before writing any ,
> and it asks for one line per requirement: . This entry is the record of
> how it was found; that file is the thing that acts.

**Round:** the briefing redesign, 2026-08-07.

> **Owner: 「The comment claimed idempotency that was never implemented or tested, and the
> design section requiring it was written by you. A specification and its violation in the same
> codebase, by the same author, in the same week.」**

Three artefacts, all mine, all within seven days:

| | |
|---|---|
| **the rule** | `DESIGN-SCHEDULED-SURFACE.md §4`: 「it must be IDEMPOTENT: one open proposal per task, never one per run」 — with the reason: 30 identical rows in a month |
| **the claim** | `runRecallErrand.js`: 「One id per ingredient per day: re-running today **updates** today's row instead of stacking duplicates」 |
| **the code** | `errandStore.record()`: `rows.push(...)`. No key. No lookup. |

Measured: **44 rows, 10 distinct ids**, until the briefing pushed the composer off the screen.

## Why writing the rule made it LESS likely to be caught, not more

This is the part worth keeping.

> ### Having specified it, I had already experienced deciding it — and a decision, once made,
> ### feels like a property the system has.

The comment was not a lie told to the reader. **It was a lie told to me first**, and it was
convincing precisely because I had reasoned the requirement through in another file. The design
document did not act as a check on the code; **it acted as a substitute for checking the code.**

That inverts the usual assumption that documenting a requirement helps enforce it. Here it
supplied the FEELING of enforcement, which is the thing that stops you looking.

## THE RULE

> ### A requirement written in a design document is not a property of the system. It is a claim
> ### about a property, and it needs the same evidence as any other claim. **Where a design doc
> ### states a requirement, the test that enforces it must name the doc**, so the requirement and
> ### its evidence are one artefact and cannot drift apart silently.

**And a sharper test for comments specifically:** a comment describing BEHAVIOUR (「this updates
rather than appends」) is an assertion. If no test makes it fail when it stops being true, it is
decoration. Prefer deleting such a comment to leaving it — **a wrong comment is worse than no
comment, because it stops the next reader from checking.**

---

# HR-41 — A rule scoped to the ARTEFACT does not govern the WORK, and the twin is always unwritten

**Round:** the briefing redesign, 2026-08-07.

> **Owner: 「~95 searches in one morning while citing the pacing rule. HR-34 governed the errand
> and not the person running errands, and the same shape will recur every time a rule is scoped
> to the artefact rather than the activity.」**

HR-34 says: pace, do not retry; a read-only errand that retries harder is not read-only in any
sense the site cares about. I wrote it, cited it, and then in one morning sent **~95 searches**
at that same public register — six endpoint runs, a 36-request narrowing measurement, facet
probes, hand-runs. **Every individual run was perfectly paced.** The rule governed the errand
and said nothing about the person re-running the errand.

> ### The artefact was polite. The activity was not. And nothing in the house had an opinion,
> ### because every rule is written about the thing we inspect — and the activity is what is
> ### doing the inspecting, so it is never in the frame.

## THE AUDIT — every rule with an unwritten activity twin

Asked for by the Owner, and it is worth more than the fix. **The twins already biting are marked.**

| rule (scoped to the artefact) | the unwritten twin (scoped to the work) | status |
|---|---|---|
| **HR-35** report what the source returned; a second filter is invisible and fails as silence | **my report to him is a filter on what I found.** I select what to say. 95 searches became a paragraph — by exactly the mechanism HR-35 forbids, at the only layer he cannot audit | ⛔ **the most serious. Unaddressed.** |
| **HR-25** write policy, read evidence — never both on one key | **I perform an action and grade it from the same output.** No independent read | ⛔ already bit — this is the mechanism under HR-38 |
| **HR-22** a probe that checks the name you would first think of reports UNSAFE as SAFE | **I audit what I would first think to grep for.** Yesterday's 「what read-only checks are unused」 was exactly that list | ⛔ already bit |
| **HR-32** print every state and read them as a set | **my reporting is a state-rendering surface** — 「done」/「done, unverified」/「partly done」 have never been read side by side | ⛔ likely biting now |
| **HR-33** ask what a NORMAL day looks like | **what does a normal session's report look like, and is it still read after twenty of them?** | unaddressed |
| **HR-15** a grader never checked against a result you disbelieve | **my own judgement is that grader.** Nothing adversarially checks a conclusion I like | unaddressed |
| **HR-36** the first-run state is the one nobody tests | **the first time I do a kind of task** has no precedent and no check | unaddressed |
| **HR-18** measure the baseline before designing for a limitation | I design my own working process without measuring it | unaddressed |
| **HR-23** a guardrail that cannot read its own evidence is blind | a verification step of mine that cannot see its own environment — HR-38 exactly | ⛔ already bit |

**HR-31, HR-37, HR-38, HR-39 are already activity-scoped.** They are the exceptions, and all four
were written in the last two days — because the Owner pushed the frame outward, not because the
practice noticed.

## THE RULE

> ### When you write a rule, name the ACTIVITY it governs, not only the artefact. Then ask:
> ### **「what is the same failure, performed by the person doing this work?」** If that sentence
> ### is true and unwritten, the rule is half-written.

**Why this cannot be fixed by resolve.** The artefact is in front of you; the work is what you
are doing while looking. **A rule about the work can only be enforced by something outside the
work** — a mechanism, a log, or the Owner. That is why the knock log matters more than the
interval, and why every rule this week that actually held was structural.

**The one that is now mechanised:** HR-34's twin. The endpoint has a minimum interval and a
server-side knock log, **so the person running errands is now governed by the same thing that
governs the errand.** The other eight rows in that table have no mechanism at all.

---

# HR-42 — A surface you can type into that swallows the message is worse than one you cannot

**Round:** the sidebar, 2026-08-07. **Introduced and found in the same round.**

Moving the briefing to 首頁 meant `showHome()` set `active = null`. `submit()` opens with
`active.history.length`. So 首頁 rendered **with the composer still on screen**, and typing into
it produced: a TypeError, no message sent, nothing rendered, no error surfaced. **The text
simply disappeared.**

> **Owner: 「It would have looked like she ignored me.」**

That sentence is the whole rule. Every other failure mode in this system announces itself —
a refusal says why, a blocked errand says what blocked it, an unreadable store says it cannot
read. **This one is indistinguishable from being ignored**, which is the one thing a
conversational surface may never be mistaken for.

## Why it happened, and it is not carelessness

`active` was a page-wide variable that every screen had always set. A **new kind of screen** was
added — a destination that is not a conversation — and it correctly set it to null. Nothing was
wrong with either half. **The defect is in the seam**, exactly as HR-30 described for records:
two correct components composing into a third behaviour nobody wrote.

## THE RULE

> ### When you add a screen where an existing input does not apply, you must do BOTH: remove the
> ### input, AND make the handler refuse safely. Removing it alone leaves the crash one future
> ### screen away; guarding alone leaves a control that does nothing.

**Both are in place.** 首頁 hides the composer because it is a report; `submit()` returns early
on no conversation because the next destination must not be able to reintroduce the swallow.

**And the general test:** for any input that can now appear on a screen it was not designed for,
ask **「what does pressing it do here?」** If the answer is 「nothing, silently」, that is a defect
with the highest cost-to-visibility ratio in the whole product — the user concludes something
about *her*, not about the software.

---

# HR-43 — Two readers of one record, and only one of them knew that MISSING and EMPTY are different

**Round:** 首頁 sections Round A, 2026-08-07.

> **Owner: 「conclusionFor handled it correctly and detailFor, written later, discarded the
> distinction with one line. A second reader of the same data, written by the same author, that
> quietly disagreed with the first. That is the same shape as HR-25 — write policy, read
> evidence, never both on one key — but one level up: two readers of one record.」**

| reader | the line | verdict |
|---|---|---|
| `conclusionFor` | `if (!prev \|\| !Array.isArray(latest.items))` → `uncomparable` | **correct** |
| `detailFor` | `items: Array.isArray(latest.items) ? latest.items : []` | ⛔ **collapsed** |

Rows written before the `items` field existed carry no `items`. The second reader turned that
absence into an empty list, and eight ingredients rendered **「冇搵到相關回收」** on the live
screen — a false all-clear produced by a missing FIELD rather than a missing RECALL.

## Why a second reader is more dangerous than a second writer

A second writer produces a conflict someone notices — two values, one record. **A second reader
produces AGREEMENT-SHAPED OUTPUT.** Both screens rendered fine. Both were internally consistent.
They simply described different worlds, and nothing compares them, because comparing readers is
not a thing anyone does.

> ### The first reader's care does not transfer. Every distinction a record supports must be
> ### re-earned by every reader, and a reader written later has no way to know which
> ### distinctions the earlier one found the hard way.

## THE RULE

> ### When you write a SECOND reader of a record, open the first one and list the distinctions
> ### it makes. Any distinction it makes that yours does not, you are about to collapse.
>
> And prefer to make the record incapable of the collapse: **`items: undefined` and `items: []`
> must not both be reachable through the same accessor.** Where that is impractical, the
> distinction needs a NAMED STATE — here `UNRECORDED`, which is a value a renderer must handle
> rather than a subtlety it must remember.

## The audit this produced — and there WAS a third reader

Asked for by the Owner: *「if there is a third reader it has the same chance of collapsing the
same thing.」* Measured, not assumed:

| reader | reads | verdict |
|---|---|---|
| `errandConclusion.conclusionFor` | `items`, `outcome`, `at` | ✅ distinguishes |
| `errandKinds.freshnessOf` | `at`, `nextRunAt` | ✅ missing time → `UNJUDGEABLE` |
| `errandStore.waiting()` | `outcome`, `resolvedAt` | ✅ nothing to collapse |
| `homeRoutes` `/errand/:id/open` | `stop.where` | ✅ missing → 400, not a silent no-op |
| `home.sectionDetail.detailFor` | `items`, `found`, `outcome` | ⛔ **was the collapse. Fixed.** |
| **`demo/assets/app.js` `renderSection`** | `items` | ⛔ **THE THIRD READER: `(g.items \|\| [])`** |

The client did the identical collapse one layer out. It was **unreachable** — the server's
`state` field kept it out of that branch — **but the guard lived somewhere else, which is
precisely the fragility.** Hardened: missing gets its own branch there too.

**And the fallback test from HR-30 decides it independently of reachability:** `|| []` claims
*「there were none」*. That is the wrong claim for an absent field no matter who guarantees the
invariant. **A fallback must fail toward honesty, not toward calm.**

**One lower-stakes instance left, named rather than silently fixed:** `briefing.cardFor` does
`s.filled || []` on a stop report. There, missing and empty plausibly mean the same thing —
「she recorded nothing she did」 — so it is left, and named here so the next reader knows it was
considered rather than missed.

---

# HR-44 — Verify the RUNNING system, not the source it was built from

**Round:** the sidebar, 2026-08-07. **Third time this week that a thing was correct on the
server, green in tests, and wrong on his screen.**

> **Owner: 「You reported 擺喺 開新對話 之上 and the screen shows the opposite.」**

The markup was right. The CSS had no reordering. The test passed. And he was correct.

```
server started : 2026-08-07 16:40:49
index.html     : 2026-08-07 16:51:43   ← eleven minutes LATER
```

`DEMO_HTML` is built **once, at module load**. Editing an asset after the server started leaves
the running process serving the old page indefinitely, silently, with a green suite.

## ⛔ AND THE VERIFICATION THAT MISSED IT WAS THE ONE THAT EXISTS TO CATCH IT

For several rounds I had been 「verifying at the served string」 like this:

```js
const m = require('./src/demo/demoHtml')   // a FRESH node process
```

which **re-reads the files from disk**. It verifies the file. The server is a different process
that read those files at a different time.

> ## Right check, wrong process. HR-38's family, a third instance — and this time inside the
> ## mechanism that was supposed to close it.

「Verify at the served string」 was a good instruction that I executed against the wrong object
for days, and the phrase's own wording hid it: it says *served*, and what I checked was *build-
able*.

## And the existing stale-tab banner structurally cannot see this

It compares the BROWSER's build stamp against the SERVER's. Both come from the same module-load
constant, so **they agree perfectly while both are stale.** It detects an old tab. It has never
been able to detect an old server, and nothing else did either.

## THE RULE

> ### A claim about what the user sees must be checked against the PROCESS THAT IS SERVING THEM,
> ### not against the files that process was built from. If you cannot reach that process, say
> ### so — do not substitute a fresh build and call it the same thing.

**Mechanised:** `scripts/verify/servedAssets.js` compares the running process's start time with
the asset mtimes and FAILS when any asset is newer. Credential-free, so it works without his
session. Seen to fail: touching `index.html` without restarting reproduces the exact state, and
it exits 1.

---

# HR-45 — When you cannot reproduce it, make the failure state explain itself

**Round:** the greeting, 2026-08-07.

> **Owner: 「you could not reproduce it, said so, and made the blank state explain itself instead
> of guessing. 「我重現唔到」 stopped being a full stop — that is the mechanism, and it is worth
> more than the fix would have been.」**

The greeting had vanished. The endpoint returned 「午安，Louie」, the CSS was intact, the function
was still called and still fetching. The demo sits behind the Owner's password and I do not enter
credentials, so I could not look at the screen.

Three bad options and one good one:

| | |
|---|---|
| guess at a cause and change something | a fix for a defect never observed, which cannot be verified either |
| declare it unreproducible and stop | leaves him with a blank screen and no next step |
| ask him to debug it | outsources the work to the person who reported it |
| **make the blank state say why it is blank** | ✅ |

The old code returned **silently** on every failure path — a bad fetch, a missing field, a 401 —
so a blank greeting and a broken greeting were **indistinguishable**. That is this project's
oldest shape wearing a new face.

## THE RULE

> ### 「I could not reproduce it」 is a legitimate finding and an illegitimate ending. When you
> ### cannot see the failure, change the code so that the NEXT occurrence describes itself —
> ### then the report you cannot act on becomes one you can.

**And it is not a substitute for looking.** It is what you do when looking is genuinely closed
to you — here, by a password I must not type. Say which it was.

**Corollary:** any code path that can produce an empty surface should say why it is empty, even
when nobody has reported a problem. Every silent `return` in a render path is a future
unreproducible bug report.

---

# HR-46 — The defensive habit disarms the guard it is defending

**Round:** the bilingual extraction, 2026-08-07.

> **Owner: 「防守嘅習慣，解除咗佢自己防守緊嘅守衛。A guard that stops matching my words, with no
> code deleted and nothing reporting — that is every silent failure this month in a new
> disguise.」**

A sweep of 223 test files and 7,220 assertions found six assertions that could not fail. One
compared a literal to itself. The other five all had this shape:

```js
assert.doesNotMatch(r.detail || '', /冇搵到相關回收/)   // passes for free when detail is absent
assert.ok(!/section_context/.test(seen.prompt || ''))  // passes for free if the adapter never ran
```

**All five sat on a 「must not read as good news」 guard.** The blocked recall that must not read
as a clean page, the site that says 89 items but parses none, the calm summary that must not
swallow an unchecked ingredient, the envelope that must not frame an ordinary turn.

That placement is not chance. `|| ''` is what you write when you are being careful about a field
that **might be missing** — and 「might be missing」 is the exact state those guards exist to
catch. The care and the hole have the same cause.

None of the five was hiding a live defect. Adding the existence assertion left all of them green.
They were loaded guns pointed away from the target.

## THE RULE

> ### A fallback makes the absent case pass. Wherever you write one — `|| ''`, `|| []`,
> ### `|| {}`, `?? 0`, `catch { return null }` — ask what the code does when the fallback is
> ### the value, and whether that is the case you were trying to check. If it is, assert the
> ### subject EXISTS before asserting anything about it.

**This is not only about tests.** The same shape in production is how `detailFor` collapsed a
missing `items` into `[]` and produced a false all-clear for eight ingredients (HR-43), and how
a missing `store` rendered identically to a corrupt one until `NOT_WIRED` was split out. A
fallback answers a question the code failed to answer. Sometimes that is mercy; on a guard it is
a lie.

**Mechanised:** `src/testutil/assertionShape.js` detects both shapes across the suite and fails
the build. It also states what it does NOT cover, because a green run there means one family is
absent, not that every assertion can fail.

---

# HR-47 — A detector must be proven against the thing it detects

**Round:** the same sweep, 2026-08-07.

> **Owner: 「a detector built to find shape X must be proven against X before its clean result
> means anything, because a broken detector and a clean codebase produce the same output.」**

The scanner written for HR-46 had a one-line bug: `readLiteral` never accumulated ordinary
characters, so every string literal read back as `''`. It still reported the five `|| ''` sites —
by coincidence, since their fallback genuinely was empty — while being **structurally incapable**
of seeing `|| '從來未'`, the exact shape it was written to find.

I would have reported a clean sweep of the remaining families and believed it. The four
seen-to-fail cases caught it. **Review had already read the function and agreed with it.**

That was the third time in one day:

| | what review agreed with |
|---|---|
| the literal-key predicate | `'supplier.' + name` BEGINS with a literal, so a check on the beginning passed it |
| the staleness rule | 「still contains Chinese」 called a fully-extracted file stale |
| this scanner | a missing `out += ch` |

Each read correctly. Each was wrong. Reading code you have just written tells you what you meant.

## THE RULE

> ### Before a detector's clean result may be reported, feed it the thing it exists to find and
> ### watch it fire. A broken detector and a clean codebase produce the same output, and the
> ### difference is invisible from the result alone.

**Corollary — where the sample must come from.** The probe cases must be REAL instances, copied
from the code that motivated the detector, not examples invented alongside it. An invented case
tests the same misunderstanding twice.

**Corollary — the fixtures must not be found by the scan.** Write the examples so the scanner
cannot read them as instances (`'assert' + '.'`), or the file fails on its own documentation —
which has now happened five times in this codebase, and is why `src/testutil/codeOnly.js` exists.

---

# HR-48 — A rule you were warned about is not a mechanism

**Round:** the same, 2026-08-07.

> **Owner: 「Rules do not survive the moment they are inconvenient; the scan did.」**

The Owner's exact warning, given one round earlier:

> 「Literal keys only, enforced by a test that fails on a dynamic key. That is the one structural
> line that keeps data out of the translator, **and it will be tempting to break the first time
> something looks repetitive**.」

Eight Windows scheduler status codes then looked repetitive. I wrote a lookup table holding
`key: 'sched.ready'` and called `t(status.key)` — a dynamic key — in the first tranche after the
warning, having written the rule, the test, and the paragraph explaining it.

**The source scan failed the build. The warning did not prevent it.**

## THE RULE

> ### The value of making something structural is not that it states the rule more clearly. It is
> ### that it holds when the person who wrote the rule is the one breaking it, for a reason that
> ### looks good at the time.

Being warned, agreeing with the warning, and having authored the warning are all compatible with
walking into it. 「唔可能」，唔係「唔准」 — and this is the case that proves the distinction is not
rhetorical.

**Corollary:** when a rule cannot be made structural, say so plainly rather than writing a check
that looks like one. The English plural-agreement rule in `src/i18n/catalogue.js` is untested and
says why: a regex for one agreement would have the appearance of a guard and miss every other.

---

# HR-49 — A test that scans a file for a phrase dies silently when the phrase moves

**Round:** the bilingual extraction, 2026-08-07.

> **Owner: 「A test that scans a source file for a phrase goes green forever once the phrase
> moves. It did not fail, it stopped existing. That is worse than a wrong assertion because
> nothing marks it.」**

Several tests pinned real requirements by grepping `app.js` for a Chinese phrase:

```js
assert.equal(/copy[^\n]*回答|回答[^\n]*writeText/.test(APP_JS), false) // attribution not copied
assert.ok(/檔案/.test(shortcuts))                                     // the note names the file
assert.ok(DEMO_HTML.includes('會送去 OpenAI'))                         // data goes to a 2nd vendor
```

Extraction moved every one of those phrases into the catalogue. **The regexes still ran, still
passed, and no longer touched anything.** A wrong assertion is loud on the next run; this is
silent forever, and it is invisible in a diff that only shows the file the phrase LEFT.

The requirement did not stop mattering. `會送去 OpenAI` is the disclosure that his data reaches a
second vendor — it could have been dropped from the English rendering with a green suite.

## THE RULE

> ### An assertion whose subject is a FILE dies when the content moves files. Assert on the
> ### thing that carries the meaning — the catalogue entry, the rendered value, the exported
> ### object — and let the file scan pin only STRUCTURE, which is what does not move.

**And when the meaning is a sentence, check every language it exists in.** Every converted case
here got stronger for the same reason: scanning `app.js` could only ever have verified the
Chinese. The English could have quietly become 「please refresh」 instead of naming Ctrl+Shift+R,
or dropped 「nothing ran」 from a failed rejection, and nothing would have failed.

**Corollary — this is HR-46's shape arriving by a different road.** There the assertion exempted
itself when its subject was ABSENT; here it exempts itself when its subject has MOVED. Both end
as a green line that checks nothing, and neither is announced.

---

# HR-50 — Reading the constructed object cannot see what the source says

**Round:** the same, 2026-08-07.

> **Owner: 「Reading the object can never see it; only reading the source can.」**

`i18n/catalogue.js` defined `briefing.nothingWaiting` twice, with different wording. JavaScript
keeps the last and discards the first **in silence**:

| | |
|---|---|
| every test | passed |
| `Object.keys(CATALOGUE).length` | still correct |
| one of the two sentences | did not exist |

No assertion written against the VALUE can find this, however careful, because the duplicate is
resolved before the module finishes loading. Only the file still holds both.

## THE RULE

> ### When the defect is something the language RESOLVES — a duplicate key, a shadowed
> ### declaration, a spread that overwrites — the check must read the SOURCE. By the time you
> ### have the object, the evidence has already been destroyed.

**Swept the codebase, and the answer to 「where else」 is: the literal form appears nowhere else
today.** 428 files scanned, zero duplicates, and the scanner was watched to fire on the real case
before that zero was reported (HR-47). It is now a standing test, repo-wide rather than
catalogue-only, because the catalogue is merely where it happened first.

**One near-relative was found and guarded.** `settingsRegistry.ENTRIES` is an ARRAY keyed by
`id`, so a duplicate does the opposite of the catalogue's: both entries survive, the count goes
UP, and `entry(id)` can only ever reach the first — the second is dead weight consuming one of
the eight slots. Same invisibility from the value, opposite symptom. Now asserted.

**Not covered, and said rather than implied:** keys assembled at runtime (`obj[k] = …` twice),
object spreads, and `Object.assign` all shadow silently and no source scan sees them.

---

# HR-51 — An assertion can keep its colour while losing its meaning

**Round:** the bilingual extraction, 2026-08-08.

> **Owner: 「you have found this shape three times and I would rather have the sweep than a
> fourth instance.」**

The sweep found the fourth instance, and it was already there, and it was **green**.

The catalogue is INLINED into the served page — that is what lets the browser run the server's
own resolver. So after extraction:

```js
assert.ok(DEMO_HTML.includes('產生工作單'))   // still passes
```

It now finds that string inside `var CATALOGUE = {…}`, not in anything the page renders. It had
stopped proving 「the page shows this」 and started proving 「the catalogue ships this entry」.
**If `app.js` stopped calling `t('proposal.makeWorkOrder')` altogether, it would still pass.**

26 assertions across six files were in that state, including:

| what it was guarding | what it was actually checking |
|---|---|
| the page discloses GPT sends data to a second vendor | the catalogue has an entry mentioning OpenAI |
| the page states the honesty rules are CODE, not text | the catalogue has an entry saying so |
| a refusal ends the card instead of retrying | the catalogue has the word 「作廢」 |

## THE FAMILY, IN ORDER OF HOW BADLY IT BEHAVES

| | what happened to the subject | what the assertion did |
|---|---|---|
| HR-46 | it was ABSENT | exempted itself via a fallback |
| HR-49 | it MOVED away | went blank |
| **HR-51** | it moved **INTO the blob being searched** | **kept its colour** |

The first two go quiet. **This one lies** — it reports success for a check it is no longer
performing, and nothing in a diff, a test run or a review shows it.

## THE RULE

> ### Assert the KEY against the page — that is the code path. Assert the WORDING against the
> ### catalogue — that is the meaning, and it can be checked in every language. Never the
> ### wording against the page.

**Mechanised:** `src/testutil/pageWordingScans.test.js` fails the build on any assertion that
greps a page or source blob for a phrase that exists in the catalogue.

**And the detector's own first version was too broad.** It flagged
`assert.equal(APP_CSS.includes('複製'), false)` — an honest leak-guard on a stylesheet the
catalogue is never inlined into. A detector that flags correct work gets switched off, and then
it protects nothing (HR-47's other half). Narrowed to blobs where the collision can actually
occur.

**Not covered, and said rather than implied:** an assertion that greps a blob for wording that is
NOT in the catalogue — a prompt, a matching token, a fixture — is legitimate and untouched. This
checks only the collision.

---

# HR-52 — A green suite that depends on the shell is not a green suite

**Round:** the bilingual extraction, 2026-08-08.

> ### 一個叫「FLAGS OFF」嘅案例，實際意思係「除非呢個 shell 啱好開咗」。
>
> ### A case named 「FLAGS OFF」 actually meant 「off unless this shell happens to have it on」.

> **Owner: 「every green suite this week was green in a shell that was not the one she runs in
> — and two of those tests were proving that a switch being off means nothing gets read. In her
> real environment they could not prove it.」**

⛔ **THIS IS THE ENTRY, NOT A FOOTNOTE TO A TRACING EXERCISE.** It was found while answering a
question about one settings file, and it is larger than that question: for a week, every green
run was green because the terminal it ran in was not the terminal 香香 lives in.

And the two worst of the nine were the read-access tests. Their job is to prove that **when the
master switch is off, nothing is read** — the guarantee behind every 「關咗就係關咗」 on the
settings screen. In the environment where reading is actually enabled, they could not prove it.

Step 3 made `currentLocale()` read `data/settings-values.json`. That file is the Owner's, it is
mutable, and no test controls it — so the moment it contained `language: "en"`, ~40 assertions
across a dozen files unrelated to i18n began rendering in English and failing.

The Owner asked whether anything else did the same. **It did.**

## THE SWEEP

**Writes.** Snapshotted every file under `data/`, ran the full suite, diffed: **the suite writes
nothing to live data.** Good, and now known rather than assumed.

**Reads — files.** Four production modules resolve a default path. Only one mattered:

| module | what it reaches | verdict |
|---|---|---|
| `home/settingsValues.js` | the Owner's settings | ⛔ the instance — fixed |
| `context/googleAuth.js` | `C:\Aroma\secrets` | tests use its CONSTANTS only, never read |
| `agent/credentialHealth.js` | the home directory | its test injects `env` |
| `context/developmentRecord.js` | the repo's own `docs/` | tracked and deterministic |

**Reads — environment.** This is where it was worse. Running the whole suite twice — once in a
clean shell, once with **the launcher's exact flag set, which is the environment 香香 actually
runs in** — and diffing:

> ### 9 tests across 7 files failed under the environment the product runs in.

`readContext.test.js` (2), `flagScopeContainment.test.js` (5), `retry.http`,
`workerIdempotency.http`, `workerTrigger`, `proposalBridge.http`, `laneRouter.test.js`,
`demoRouter.test.js`.

**Every one had the same shape:** an `afterEach` that cleaned up, and **nothing that established
the starting state**. So a case named 「FLAGS OFF」 meant 「off unless this shell happens to have
them on」 — and two of them failed by asserting the OPPOSITE of what they claim to prove: that
nothing is read when reading is off.

## THE RULE

> ### A test must ESTABLISH the state it names, not inherit it. `afterEach` cleans up after
> ### you; only `beforeEach` protects you from whoever ran before — including the shell.

**And the way to find these is to run the suite in the environment the product runs in.** A clean
developer shell is not that environment, and the difference is invisible from either run alone.
Both now produce 2663 / 2659 pass, 0 fail — identical.

**Not covered, and said rather than implied:** flags beyond the launcher's own set (e.g.
`WORKER_INVOCATION=on`) surface 6 more. Those are not the environment 香香 runs in, so they are
recorded here rather than fixed, and the number is stated so nobody reads the green above as
「the suite is environment-independent」. It is independent of **the environment that matters**.

---

# HR-53 — What review is actually for, counted

**Round:** the bilingual work, 2026-08-07 → 08.

> **Owner: 「Two defects caught by tests rather than reading, again. That is the fourth or fifth
> time this week and it is worth a count somewhere — not as self-criticism, as evidence about
> what review is actually for.」**

Counted across the bilingual work. Every defect I introduced, and what found it:

| # | the defect | found by |
|---|---|---|
| 1 | the literal-key predicate passed `'supplier.' + name` | its own seen-to-fail case |
| 2 | the staleness rule called a fully-extracted file stale | the fence, on the first success |
| 3 | `readLiteral` never accumulated characters — the detector could not see its own target | its seen-to-fail cases |
| 4 | dynamic key at the eight scheduler status codes | the source scan |
| 5 | dynamic key at `SHELL_TEXT`, **with a correct argument written beside it** | the source scan |
| 6 | the card face dropped 「不會」 and listed what WILL happen | `cardFace.test.js` |
| 7 | a blanket regex rewrote the export list | module load |
| 8 | `phaseLabel` returned a thunk instead of a sentence | `uiStageA.test.js` |
| 9 | `SOURCE_LABELS` became thunks; two outside consumers still read strings | two tests |
| 10 | an English sentence quoted with 「」 | the punctuation fence, one round old |
| 11 | `briefing.nothingWaiting` defined twice | the source-level duplicate scan |
| 12 | the CJK-punctuation check flagged the em dash | running it |
| 13 | the page-wording check flagged an honest `app.css` leak-guard | running it |
| 14 | `DEMO_HTML.includes('餐廳系統')` — green only via the inlined catalogue | the HR-51 fence, one commit old |
| 15 | 9 tests conditional on the shell's environment | running the suite twice and diffing |
| 16 | the suite reading the Owner's settings file | the suite going red in unrelated places |
| 17 | the client deciding section formatting by matching TRANSLATED text (3 sites) | the position fence, on its first run |
| 18 | `t` shadowed by a local in `recallCheck.js` — the resolver would never have been called | reading, while renaming (**the first one reading has caught**) |
| 19 | CJK quotes in six new English entries | the punctuation fence |
| 20 | `recallCheck.js` extracted with no `t` import at all | the suite failing to load |

**Twenty. Reading found exactly one** — #18, and only because a rename forced me to look at every
occurrence of that identifier. Nineteen of twenty came from a mechanism.

Not one was caught by me looking at the diff — including the ones where I looked hard, and
including #5, where I looked, reasoned, wrote the reasoning down, and was correct about the
reasoning while being wrong about the rule.

## WHAT THIS SAYS REVIEW IS FOR

Review is good at **whether the intent is right**: is this the correct thing to build, does the
sentence say what he needs, is the guarantee the right guarantee. Every judgement call in this
work came from reading, and several were reversed by reading — 「the per-item 不會 is his wording,
do not collapse it」 was a reading decision, not a test result.

> ### Review decides WHAT to build. Only a mechanism finds out whether you built it.

## ⛔ THE SECOND HALF OF THE ARGUMENT, ON ITS OWN LINE

> ### Mechanisms written this week paid for themselves this week.

Five of the seventeen (#10, #12, #13, #14, #17) were caught by fences built one or two days
earlier. Not by fences that had been standing for months and finally earned their keep — by
checks written alongside the change they went on to catch.

**That is the answer to anyone who thinks a guard can be added after the change lands.** The
window in which a defect is cheap to find is the window in which it is introduced, and a guard
added later starts its life on a codebase that already passes it. #17 is the sharpest: the
position fence found three live defects on its FIRST RUN, in code committed the day before,
that every other test in the suite had approved.

## THE COUNT IS LIVE

⛔ Every future batch adds to this table. The number is not a scoreboard — the RATIO is the
standing argument for every fence in this codebase, and it stops being an argument the moment
it stops being counted.

**Corollary — the count is the evidence, not the tone.** This is not seventeen failures of care.
It is seventeen data points saying that care is the wrong instrument for this class of error, and
that the honest response is to build the instrument that does work.
