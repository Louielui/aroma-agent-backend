# The dispatch path — removing the Owner from the relay

<!-- record-status: ACTIVE 2026-08-06 -->

**DESIGN ONLY. No code, nothing built.** 2026-08-06.

> **Owner, stating the reason so it shapes the design:** 「I pasted about twenty times
> yesterday and maybe three of those were approvals. The rest was me carrying text between
> you and Claude. **I am the transport layer, and that is what I want gone — not the
> gates.**」

---

# 0. THE FINDING THAT REORDERS THE WHOLE DESIGN

**The thing he asked for first is not the thing that removes him from the relay.**

| | removes the relay? |
|---|---|
| **dispatch by capability** (item 1) | **no** — it changes *which* worker is called, not how many times he is |
| **multi-turn** (item 2) | **yes** — 17 of yesterday's ~20 pastes were carrying a result into the next round |

Yesterday's investigation was **four rounds, each shaped by the previous result**. A single
dispatch that returns once does not replace him; it replaces one of four pastes.

> ## Item 2 is the feature. Item 1 is an abstraction with one implementation.

And that is not a guess — **the entry rule already decided it**: today there is exactly ONE
admissible worker. A capability registry built now would have one entry in it.

---

# 1. WHAT GENERALISING AGENT BRIDGE ACTUALLY COSTS

## What already exists and works

```js
// src/agent/agentBridgeWorker.js
claudeCandidates(env)                              // hardcoded path resolution
buildAllowedTools() → ['Read', 'Edit', 'Write']    // hardcoded, per-process
['-p', goal, '--allowedTools', …, '--output-format', 'json']
```

Plus: sealed order, disposable clone with no remote, bounded output, hard timeout, cost cap,
workspace containment re-checked before spawn, and a durable audit record. **All of that
carries over unchanged.**

## What dispatch-by-capability would add

| change | size |
|---|---|
| a worker registry: capability → `{ transport, fence, tools, resultKind }` | small |
| the arg array built by the worker's own adapter rather than inline | small |
| the sealed order gains `worker`, `capability`, `fence` | already designed |
| **`buildAllowedTools()` becomes PER-ORDER, not per-process** | **this is the fence ruling arriving as a requirement** |

That last row is the only one that is load-bearing, and it is required **whether or not**
anything is generalised: the array is a fence made of absence, and a per-order grant is the
form that keeps it one.

## Recommendation, against the request as phrased

> **Generalise the ORDER SHAPE and the FENCE CHECK now. Leave the transport hardcoded until a
> second admissible worker exists.**

A registry with one entry is not extensibility, it is indirection — and this project has
spent a week removing things that read as structure while doing nothing. **The order shape is
different**: it is what the sealed record must carry, and it is wrong today regardless of how
many workers there are.

---

# 2. MULTI-TURN — the actual feature

## The mechanism exists, measured

```
-r, --resume [value]     Resume a conversation by session ID
--session-id <uuid>      Use a specific session ID (must be a valid UUID)
```

and the JSON result already returns `session_id`, `num_turns`, `total_cost_usd`.

> ### So the dispatcher sets `--session-id` on round 1 and `--resume` after.

## ⚠ WITHOUT SESSION CONTINUITY, THE RELAY PROBLEM MOVES DOWN A LEVEL

If each round is a fresh session, round 2 must be handed round 1's findings **as text**. Then
**she** becomes the transport layer instead of him — the same defect, one level down, and
harder to see because nobody is watching the pastes.

**That is the argument for continuity being part of the design rather than an optimisation.**

## What stops it running away

**No `--max-turns` flag was found in the CLI.** `num_turns` is *reported*, not *bounded*. So
the cap cannot be delegated to the worker — **the dispatcher must hold it**, across dispatches:

| bound | enforced by |
|---|---|
| **rounds per enquiry** | the dispatcher counts; the CLI cannot |
| **cost per enquiry** | sum `total_cost_usd` across rounds, checked **before** each dispatch |
| **wall clock** | already exists per-spawn; needs an enquiry-level total |
| **no-new-information** | if round N's result does not change the question, stop |

## What a cost cap MEANS when the number of rounds is unknown

It stops being a call budget and becomes an **enquiry budget**. Two consequences:

1. **Checked before each round, against what remains** — not after, when it is already spent.
2. **The measured baseline is real**: one trivial call cost **$0.106**. A four-round
   investigation is not four trivial calls. The budget must be set from observed rounds, not
   from a guess.

### ⚠ AND THE PART THAT MATTERS MORE THAN THE NUMBER

> ## An enquiry that stops because it ran out of budget must NEVER render as an enquiry that finished.

`STOPPED_ON_BUDGET` is a distinct outcome from `CONCLUDED`, and it belongs in the **first
line** of the report, not the last. This is HR-13's family: the thing that did not happen has
to be visible, and a truncated investigation that reads as a conclusion is `count: 43` in a
new costume.

---

# 3. WHERE THE OWNER RE-ENTERS — three by design, and the third is half a wish

## The two that are straightforwardly implementable

**1. Anything touching production.** Already structural: no SSH key on this machine, no
remote in the clone. The re-entry is the sealed order and the patch he applies — which exists
and works.

**2. Anything spending beyond a cap.** The CLI reports `total_cost_usd` per call. Checked
before each round against the remaining enquiry budget.

## 3. 「Anything where she would otherwise proceed on an unmeasured assumption」

> ### Half implementable — and the implementable half is the one that mattered.

**NOT implementable:** detecting that she never thought to check the view definition. That is
detecting an absence in reasoning, and nothing in the record marks it.

**IMPLEMENTABLE:** refusing to conclude when **the evidence record declares its own
limitation**. The read layer already carries these, today:

- `completeness: 'sample'` — the answer is a sample and the conclusion treats it as whole;
- `truncated: true` — a cap was hit;
- a read state of `NO_RELEVANT_RESULTS` used to support a positive claim;
- **a conclusion drawn from a set whose filter correlates with the claim** — HR-12.

That is a **structural check on the evidence, not on the reasoning**, which is why it can be
built at all.

### The honest test — against yesterday's own four wrong conclusions

| wrong conclusion | caught by this check? |
|---|---|
| **「ruled out: already ordered」** — checked incoming on the 43 *returned* rows | **YES.** The set was produced by the very filter that removed the answer |
| INNER JOIN drops rows | no — required measuring a view nobody had queried |
| NULL comparison | no |
| string coercion | no |

**One of four. And it is the first one** — the one whose false negative made the other three
necessary. **Catching it would have prevented all four.**

That is the honest claim: not 「she will stop assuming」, but **「she cannot conclude from a set
that declared itself partial」**, which is narrow, buildable, and would have saved yesterday.

## A fourth re-entry he did not name, now possible

**When a conclusion contradicts an ACTIVE entry in the development record.** She can read that
record as of tonight. If she is about to conclude something a current ruling contradicts,
that is a stop — not because the record is authority over reality, but because *one of the
two is wrong* and he should decide which.

---

# 4. WHAT SHE REPORTS

**Not a transcript.** The transcript is the thing he is trying to stop reading.

## The shape — five parts, in this order

```
1. OUTCOME       CONCLUDED / STOPPED_ON_BUDGET / BLOCKED_NEEDS_YOU / FAILED
2. THE ANSWER    one or two sentences, with the number in them
3. WHAT WAS      the measurements, each one a fact he could re-run
   MEASURED
4. NOT           what was NOT established, named — not omitted
   ESTABLISHED
5. COST          rounds, dollars, and whether anything was applied
```

**Modelled on yesterday's honest summary**, which was three sentences and a number:

> 「查完。唔係缺陷 —— 嗰 18 樣已經落咗單。has_incoming 18,61 − 18 = 43。冇改過任何嘢。」

Outcome, answer, measurement, and the fact that nothing was applied. **That is the target
shape**, and it is short because it is honest, not despite it.

## What it must NEVER claim

| never | because |
|---|---|
| **「I fixed it」 when nothing was applied** | the obvious one, and the patch that was never applied yesterday is the proof it can happen |
| **「verified」 when only read** | reading a file is not running it |
| **a cause without a measurement in the same report** | yesterday produced three |
| **that a defect is handled because a document exists** | the record rule, already written |
| **that it finished, when it stopped on budget** | §2 |
| **a number from a source that declared itself a sample** | without saying so |

---

# 5. WHAT THIS DOES NOT DO

**Stated explicitly, because the shape invites the opposite reading.**

- **It gives her NO new capabilities.** Claude Code does exactly what it could do yesterday:
  `Read`, `Edit`, `Write`, in a disposable clone with no remote.
- **It does not let her touch production.** The wall is the absent SSH key, and that is
  preserved on purpose.
- **It does not add the third execution mode.** Nothing runs unattended; there is still no
  scheduler.
- **It does not make the browser reachable** — measured tonight, `TOOL_NOT_AVAILABLE`.
- **It does not widen the tool grant.** If anything, it narrows it: per-order rather than
  per-process.

> ## It removes ONE thing: the Owner as the transport between two systems that can already talk.

## ⚠ AND THE COST OF THAT, WHICH IS REAL

Today he sees **every intermediate result**, because he is pasting them. That is an accident
of the relay — and it is also, accidentally, a review at every step. Yesterday he caught the
INNER JOIN claim, the NULL claim and the string-coercion claim **because each one passed
through his hands**.

> ### Removing the relay removes an accidental safety property.
>
> After this he sees the report, not the rounds. **So the report's honesty is not a nicety —
> it is the only remaining place the four wrong diagnoses would have surfaced.**

That is the argument for §4 being as strict as it is, and for §3's fourth re-entry existing at
all. **The gates he keeps are the ones he named. The one he loses is the one he never chose.**
