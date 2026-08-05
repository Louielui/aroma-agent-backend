# House rules

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
