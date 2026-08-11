# THE ROUTE / AUTHOR SPLIT — DESIGN

**Design only. No code this round.**

One 400-token call currently does two jobs with opposite requirements: it decides whether a
message is a change request, and it **authors the task string a worker executes**. Splitting
them dissolves both A and B — nothing needs pinning once the cheap decision and the
consequential one stop sharing a budget.

---

## 1. 「ROUTE DETERMINISTICALLY」 — NOT A THIRD INSTANCE. A DUPLICATE.

> Asked: is this a third instance of the deterministic-entrance pattern, or genuinely different?

**Neither. There is already a deterministic router making this exact distinction, and it is
already running on every turn.**

`src/intake/turnRouter.js` → `routeTurn(message)`:

```js
const ROUTES = Object.freeze(['UTILITY', 'ACTION', 'BUSINESS_QUERY', 'CONVERSATION'])
```

Zero model calls. Priority-ordered. Returns `confidence` on every outcome. Wired and live
(`TURN_ROUTER='on'`).

**`ACTION` is the routing half of what the 400-token model call is doing.** The classifier is not
a missing capability — it is a second implementation of a router this system already has, paid
for with a model call on every turn. **That is HR-59 for the fourth time**, and it is the whole
answer to 「what does routing deterministically look like here」: it looks like the thing already
installed.

`requestInference` and `settingsOffer` are the same family but a different job — they read
DETAIL out of a sentence. `routeTurn` decides WHICH KIND of turn it is. The split needs the
second, and it exists.

### ⛔ AND THE HONEST PART: A CLOSED ENUM CANNOT COVER WHAT HE ACTUALLY TYPES

Measured against the real record — 58 Owner messages across 29 conversations:

| | |
|---|---|
| **median message length** | **9 characters** |
| looks like a change request only | 8 |
| looks like a question only | 42 |
| both signals present | 1 |
| neither | 7 |

*(Bucketing is crude keyword matching and is stated as crude — `改`/`加` appear in business
contexts too. The shape is the finding, not the counts.)*

Real examples, verbatim:

```
聽日幾號？
12乘34係幾多？
幫我改 docs/canary/agent-canary.md，第二行改成 line 3
香香，到 aroma system，看看今天要向 costco 訂什麼貨
```

**Two things follow, and the second is the uncomfortable one.**

1. **Change requests are ~14% of traffic.** The expensive authoring path would run on roughly one
   turn in seven. That is the case FOR the split — it is cheap precisely because it is rare.
2. **A nine-character median gives a deterministic router very little to work with**, and
   `routeTurn` is deliberately ZERO-CONTEXT. 「第二行改成 line 3」 in isolation is not obviously a
   change request; it is obviously one only if you saw the previous turn.

**So a closed enum covers the clear cases and cannot cover the short ambiguous ones. That is not
a reason to reject it — it is the reason §4 exists.** A router that must be right on every input
is the wrong design; a router that is right on the clear ones and ASKS on the rest is the right
one, and it matches what this system already does everywhere else.

---

## 2. PER-CALL `servedBy` — PRECONDITION, NOT NICETY

Two models in one turn with a turn-level label describes neither. HR-62 rebuilt on purpose.

**Shape:** `servedBy` becomes a LIST, one entry per model call, each naming what that call did:

```
servedBy: [
  { role: 'route',  model: null,             deterministic: true },
  { role: 'author', model: 'claude-opus-5',  ms: 46803 }
]
```

Three properties it must have:

- **`deterministic: true` is a first-class entry, not an omission.** The routing half makes no
  model call, and a list that simply lacks it reads as 「we do not know」 rather than 「nothing was
  asked」 — the `|| ''` shape one level up.
- **Absent stays absent.** A call whose model is unknown reports `null`, never the configured
  default read back.
- **The UI shows the AUTHORING model on a proposal card**, because that is the one whose
  judgement the Owner is approving.

**This ships BEFORE the split, not with it.**

---

## 3. THE AUTHORING CALL FAILS — AND A HALF-AUTHORED WORK ORDER MUST BE IMPOSSIBLE

### Today, before the split

`propose()` calls `await classifyIntent(...)` FIRST and constructs the Proposal only after it
returns. **Nothing is written before the model answers, so a half-built work order cannot exist
today.** That property is not accidental and must survive the split.

### But today also has a defect the split must NOT inherit

`classifyIntent` catches everything:

```js
catch (err) { return chat(`classifier unavailable: ${err.message}`) }
```

A timeout therefore returns `{intent:'chat'}` and `propose()` returns `{intent:'chat',
proposal:null}`. **A work request silently becomes a conversation.** Not half-executed — LOST.
And `chat()` builds an object with an `explanation` and **no `reply`**, so the route answers 200
instead of 201 carrying a reason the screen may never show. **This is HR-67's shape — a failure
emitting the success path's vocabulary — one subsystem over, and it will fire far more often once
authoring runs a thinking model at 120s.**

### The design

**Structural, not careful:**

1. **The Proposal object is constructed from an authoring RESULT, and there is no code path that
   constructs one from a partial.** Authoring returns a complete task + targetProject, or it
   throws. No field is filled in from a default, and `targetProject` is never inferred when the
   authoring call failed.
2. **Persistence happens after validation, in one step.** The existing order (classify → build →
   `flush()`) is already correct; the split keeps it and adds nothing between build and flush.
3. **An authoring failure is its own outcome, not a chat reply.** `{ intent:'develop',
   proposal:null, authoring:'failed', reason:'timeout'|'overloaded'|'unreadable' }`. The Owner
   asked for work; he is told the drafting failed and why. **He is never told it was a
   conversation.**
4. **No retry inside the turn.** `Overloaded` is real and retries are a separate decision; a
   retry that ran after a partial write is exactly how two work orders get created from one
   request.

> **A work order that does not exist is recoverable by asking again. A work order that half
> exists is not, and the Owner types EXECUTE against it.**

---

## 4. THE ROUTING HALF FAILS CLOSED — IT ASKS

> **Same shape as 「唔中唔係拒絕，亦唔係猜，係一句普通反問」.**

`routeTurn` already returns `confidence` on every outcome, so the signal exists.

**Rule:** when the route is ambiguous between ACTION and anything else — or confidence is not
high on a message short enough to be either — the turn produces **one plain question**, not a
guess and not a refusal:

```
你係想我幫你改嘢，定係想我答你？
```

Three properties:

- **It asks, it does not refuse.** A refusal on an ambiguous nine-character message is the
  「notAsked」 defect: the planner declining on the Owner's behalf.
- **It does not author.** No expensive call is made on a turn nobody has established is a change
  request — which is also what keeps the cost story true.
- **It costs nothing.** The routing half is deterministic, so an ambiguous turn spends zero model
  calls and answers instantly.

**And the failure direction matters:** guessing CONVERSATION loses a work request silently
(today's defect). Guessing ACTION spends a 46-second authoring call on 「聽日幾號？」. Asking
costs one short question and is wrong in neither direction.

---

## WHAT THIS DOES NOT DECIDE

The timeout (120s) and the `Overloaded` record stand from the previous round. Whether opus
returns at all is a separate decision, and the measurement that would settle it — **is haiku
actually worse on the questions he asks day to day, or only on the hard ones I chose** — is still
unrun. On the one short prompt timed, opus returned text with no thinking block in 7.6s: the same
shape as haiku, at the same speed.

**Next after this lands: PR #37, rewritten against A1's vocabulary rather than its own.**

---

## ⛔ KNOWN GAP, LEFT OPEN DELIBERATELY — THE SPLIT DID NOT CLOSE IT

> **Owner: 「Record what that leaves open, so nobody reads the split as having closed it.」**

**A genuinely ambiguous short message still routes by whatever the model says.**

`routeTurn` reaches `CONVERSATION` with `reason: 'default'` when nothing matched — which on a
nine-character median is most ordinary chat. The split takes the deterministic decision only
where the router speaks POSITIVELY (`UTILITY`, `BUSINESS_QUERY`, `ACTION`). Everything else
keeps today's behaviour exactly.

So `「第二行改成 line 3」` with no preceding context still has its develop-or-not decided by the
model, and a model that gets it wrong there gets it wrong exactly as it did before.

**This is not a defect to fix now.** Closing it needs a 「looks like a change request」 detector
that `routeTurn` does not provide, and inventing one inside this change would have been the
fifth duplicate (HR-71). The candidate is `requestInference`, which already extracts a concrete
target out of a sentence — if it finds one on a default-routed turn, that is the ambiguous case
worth asking about. **Proposed, not built, and not measured.**
