# House rules

<!-- record-status: ACTIVE 2026-08-06 -->

Rules the Owner has set that apply across the whole codebase, not to one feature. Each one
exists because something went wrong once; the story is kept because a rule without its
reason gets argued away.

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
