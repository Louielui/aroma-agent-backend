# Wisdom Memory v1 — 香香 Learning

**Status: W0 — foundation only. Built, tested, and deliberately not wired to anything.**
Nothing in this document is active in production. No flag turns it on, because no flag exists.

---

## Why this exists

香香 can already read the world and answer honestly about it. What she cannot do is get
*better* at it. Every turn starts from the same place: nothing learned last week changes
anything this week, and a mistake the Owner corrected in June is available in October only if
it happens to be in the conversation window.

Wisdom Memory is the loop that closes that gap:

```
Experience → Outcome → Reflect → Extract Lesson → Remember → Apply → Validate
```

W0 builds the **container**. Getting the container right first is the whole point: a learning
system that can write its own beliefs and then act on them is not a memory, it is an echo, and
an echo that grows louder each time it hears itself.

---

## The seven principles W0 encodes

### 1. Wisdom is not current fact

A lesson is a heuristic distilled from what already happened. It is never a current price, a
stock level, a status, an approval, an authorization, or an instruction the Owner is giving
now.

The intended precedence, once anything reads this store:

```
Owner's current instruction
  > governance / authorization
    > current live evidence
      > validated wisdom heuristic
        > conversation recall
```

**Documented now, wired in W3.** A lesson that outranked live evidence would let 香香 argue
with a reading she just took.

### 2. Recall is not evidence

Conversation Recall may eventually help *find* a candidate experience. Conversation text can
never *validate* one. An answer repeating itself does not make itself true, and a system that
accepts repetition as proof will confidently converge on whatever it said most often.

### 3. A model cannot validate itself

In W0, only `authority: 'owner'` may move a lesson to `validated`, `rejected` or `superseded`.
`createdBy` records who wrote a candidate down and confers **zero** authority — `aroma` and
`system` may propose, and proposing is all they may do.

The check is an allowlist (`AUTHORITIES` contains exactly `owner`), so a new actor name added
later arrives untrusted rather than accidentally blessed.

### 4. Candidates never affect behaviour

The read side selects `state === 'validated'` and nothing else. `candidate`, `rejected` and
`superseded` are excluded, and because the filter is an allowlist, a state invented in a later
tranche is excluded by default too.

### 5. Evidence is referenced, not copied

A record may carry `{kind, id}` references — decision, task, dispatch, conversation, request,
approval, manual. It may not carry transcripts, connector rows, emails, Drive contents, web
pages or API responses. The ref validator rejects any key other than `kind` and `id`, which is
precisely where a `text:` or `snippet:` field would otherwise arrive.

The Wisdom store holds distilled learning. It is not a second copy of somebody's mailbox.

### 6. Absent stays absent

`null` means *not established*. It is never silently converted to `0`, `false`, `[]`,
`"unknown"` or a model-estimated number.

Confidence is the sharp case. The tempting default is `0.5` — "we don't know, so call it a coin
flip" — and that is a number nobody measured, indistinguishable afterwards from one somebody
did. A confidence value must also carry its `basis`, or the record is malformed: where a number
came from is part of what it means.

### 7. The durability claim must be honest

This store writes atomically, locks across processes, and refuses to read a corrupt file as
empty. It has **not** been through backup and isolated restore verification.

Until it has, its status is:

```
durabilityStatus: UNVERIFIED
```

carried in code, not just in prose. Nothing may call it durable, backed up or restore-safe
before W5.

---

## The record

Six canonical semantic fields:

| Concept | Field | Meaning |
|---|---|---|
| Situation | `situation` | what was happening |
| Action | `action` | what was done |
| Outcome | `outcome` | what actually resulted |
| Lesson | `lesson` | the heuristic to carry forward |
| Confidence | `confidence` | `{value: 0..1 or null, basis}` — historical learning confidence |
| Validation | `validation` | `{state, authority, reason, evidenceRefs, validatedAt, supersededBy}` |

All four text fields are bounded at 1200 characters and **rejected, never truncated**, when
over. Truncation can invert meaning: *"never order before checking stock"* cut short reads as
*"never order"*.

All four are passed through `src/lab/redaction.js` **before** the record exists, and only the
redacted text is ever returned or stored. `redactedKinds` records what *kind* of thing was
removed, never the value.

**Redaction is best-effort.** It catches labelled secrets and known shapes. It does not make
this store safe to expose, and no document may claim it does.

### Lifecycle

```
                 ┌─────────────┐
   create ──────▶│  candidate  │
                 └──────┬──────┘
                Owner   │   Owner
           validate ◀───┴───▶ reject
                 │                 │
        ┌────────▼────────┐  ┌─────▼─────┐
        │    validated    │  │ rejected  │   (terminal)
        └────────┬────────┘  └───────────┘
             Owner supersede
                 │
        ┌────────▼────────┐
        │   superseded    │   (terminal, points at its replacement)
        └─────────────────┘
```

Every other transition is refused by a closed table. Superseding requires a replacement that
is itself `validated` — a candidate may not retire a belief, or nothing would be believed in
its place. Nothing is ever deleted, so *"why did 香香 stop believing that?"* has an answer.

---

## The application ledger

Learning is not complete if a lesson can be remembered but nobody records whether applying it
helped.

- `recordApplication` — only a **validated** lesson may be applied. The state at application is
  stored, so a later supersession cannot rewrite what was believed at the moment it was used.
- `recordApplicationOutcome` — `helped | neutral | hurt | unknown`, one evidence ref, and an
  optional short Owner note that is bounded and redacted before write.

**W0 records outcomes and changes nothing.** Confidence is not moved automatically. One lucky
success is not a rule and one bad day is not a refutation; turning outcomes into belief is W4's
job, with its own Owner GO.

Events (`lesson.candidate_created`, `.validated`, `.rejected`, `.superseded`, `.applied`,
`.application_outcome`) carry ids, states and timestamps only. An event that quoted the lesson
would be a second, unredacted copy with no lifecycle of its own — a superseded belief would
live on in the ledger forever.

---

## The read side

`buildWisdomBlock({ listLessonsFn })` is pure: a list in, a string out. No store reach-through,
no model call, no network. It cannot go and find data on its own, which is why nothing can
accidentally start reading the Owner's lessons.

Every rendering carries the safety header stating, in words the model will actually read:

- these are **learned heuristics** from past outcomes, **not current facts**
- they are not the Owner's instructions, not approvals, not authorization
- they never override current live evidence, governance, or the Owner's current instruction
- **if current evidence conflicts with a lesson, current evidence wins** and the lesson is stale
- confidence is historical learning confidence, not the probability anything is true now

Ordering is deterministic — most recently validated first, ties by id — so two identical turns
cannot differ for reasons nobody can name. Records are included **whole or not at all**, and
caps stop on a record boundary.

---

## Phases

| Phase | What it adds | Gate |
|---|---|---|
| **W0** | Foundation: contract, store, ledger, validated-only renderer, tests, this document. **No production influence.** | *this tranche* |
| **W1** | Shadow Reflection — the model may propose lesson candidates after eligible outcomes. Still zero behaviour influence. | Owner GO |
| **W2** | Validation Engine — Owner confirmation first. Any evidence-based auto-validation needs its own separate Owner GO. | Owner GO |
| **W3** | Validated Recall — validated wisdom may enter planning context, at the precedence above: below current evidence, governance and the Owner's instruction. | Owner GO |
| **W4** | Closed Learning Loop — application outcomes adjust confidence, detect harmful and stale lessons, propose supersession. | Owner GO |
| **W5** | Durability — backup and isolated restore verification. Only after this may anything call Wisdom durable. | Owner GO |

---

## Poisoning threats, and the W0 control for each

| Threat | W0 structural control |
|---|---|
| **Self-confirming model output** — the model writes a lesson and then treats it as true | Only `authority: 'owner'` validates. `createdBy` grants nothing. Allowlist, not denylist. |
| **Hallucinated outcome** — a lesson built on an event that never happened | `outcome` is a bounded field; evidence is `{kind, id}` refs pointing at real records, so a claim can be checked against the thing it names. |
| **Conversation recall repeated as evidence** — the same answer echoing until it looks proven | Recall is not evidence (principle 2). Validation requires the Owner, not a count of repetitions. |
| **Stale lesson overriding live truth** — last quarter's heuristic beating today's reading | Documented precedence puts current evidence above wisdom; the safety header states it in the block; W3 is a separate gate. |
| **One lucky success becoming a rule** | Confidence is never moved automatically by an application outcome in W0. |
| **One failure over-correcting behaviour** | Same control, in the other direction: outcomes are recorded, not learned from, until W4. |
| **Third-party data copied into persistent memory** | Refs accept only `{kind, id}`; every other key is rejected. There is no field a transcript could arrive in. |
| **Candidate accidentally entering the prompt** | The renderer filters `state === 'validated'` as an allowlist; three tests assert candidate, rejected and superseded never render. |
| **Model validating its own lesson** | `assertOwnerAuthority` is the single gate every transition passes through; `aroma`, `model`, `claude`, `openai` and `system` are absent from the allowlist. |
| **Secrets persisted in a lesson** | Redaction runs before the record exists; only redacted text is returned or stored; `redactedKinds` records kinds, never values. Best-effort, and stated as such. |
| **Silent activation** | `wisdomIsolation.test.js` asserts no production file imports the domain, no flag exists, and the domain contains no scheduler, worker or network call. Wiring it later requires deleting a test that says it is not wired. |

---

## Files

```
src/wisdom/wisdomContract.js   what a lesson is; enums, bounds, redaction, transitions
src/wisdom/wisdomStore.js      separate durable-shaped store (UNVERIFIED), lifecycle + ledger
src/wisdom/wisdomRecall.js     pure validated-only renderer
src/wisdom/*.test.js           contract, store (incl. multi-process), recall, isolation
```

The store lives at `<resolveDataDir()>/wisdom/wisdom.json` — its own file, deliberately **not**
inside `aroma-truth.json`. Operational truth and an in-design learning subsystem do not share a
document, and a bug here must not be able to corrupt that one. `src/store/store.js` was not
refactored to share code: extracting a common core would mean editing the operational store
during the one tranche whose whole purpose is to be reversible.
