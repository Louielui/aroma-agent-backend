# DESIGN — the no-evidence gate. **NOT BUILT.**

Design only, at the Owner's instruction. Nothing in this document is wired.

## The failure it exists for

> 「Aroma System 目前沒有專門的網站，現在我們有三間門市」

Specific, plausible, wrong in a way the Owner could not check, produced by a turn that read
nothing. Every guard passed, each correct on its own input, because **every guard is a relation
between a claim and evidence and there was no evidence to relate to** (HR-74).

## ⛔ THE QUESTION THE OWNER ASKED, ANSWERED PLAINLY

> **「Say whether that distinction is available structurally or only by reading prose. If only
> by prose, say so plainly — we have measured a prose detector at recall 1/6.」**

It splits in two, and only one half is needed.

| | available how |
|---|---|
| **A. Did this sentence make a SPECIFIC claim?** | **STRUCTURALLY.** A specific claim carries a specific token — a numeral, a price, a date, a name. Whether that token appears in the turn's inputs is set membership, not comprehension. |
| **B. Is the claim ABOUT the business?** | **PROSE ONLY.** Separating 「我們有三間門市」 from 「有三種方法」 needs topic understanding. This is the 1/6-recall detector and it is NOT proposed. |

### ⛔ AND THE DESIGN DOES NOT NEED B AT ALL. THAT IS THE WHOLE IDEA.

The gate runs **only on turns that read nothing**. On such a turn, a specific unsourced quantity
is unsupported *whatever it is about*. The gate never has to know the topic — it has to know the
token has no source. **The hard half is dissolved by restricting when the gate runs, not by
solving it.**

## The check, and it is measured rather than described

```
fires  ⟺  the turn read ZERO rows
      ∧  the reply contains a SPECIFIC token
      ∧  that token appears in none of: the Owner's question, the conversation history,
         any row read this turn
```

Measured against the real example and two real legitimate replies from the same runs:

```
                    naive (any numeral)      syntactic (numeral+measure word+noun)
⛔ THE INVENTION    三          ✅ caught     三間門       ✅ caught
   legit clarify    一          ⛔ FALSE      —            ✅ silent
   legit refusal    一,一,一     ⛔ FALSE      一個明       ⛔ FALSE
```

**Naive is useless** — 「一」 is Chinese's indefinite article, so it fires on 「一下」「一個」.
The syntactic form is better and still fires on 「一個明確」.

⛔ **Excluding bare 「一」 would give 1 hit / 0 false alarms on these three — and would also miss
「我們有一間門市」, a genuine invention numbered one.** That trade is real and must not be picked
from three examples. It is exactly the 「do not pick a number that feels safe」 case.

## ⛔ THE PROPERTY THAT DECIDES THE ROLLOUT: THIS COSTS ZERO MODEL CALLS

B's shadow was refused because 「shadowing a semantic decision means a second paid call per turn」.
**That objection does not apply here.** This gate is a regex and a set membership test over a
string already in hand. Shadow is FREE.

So the rollout writes itself, and it is the opposite of B's:

1. **Measure in shadow, free, on every zero-evidence turn.** Log: would it have fired, on which
   token, in which reply. Change nothing.
2. **Let the Owner's real turns produce the false-positive rate** — not three examples chosen by
   the author, and not phrases invented to test it (HR-28).
3. **Only then choose the action**, with the rate known.

## What the gate must NOT do

⛔ **Not refuse the reply.** Owner's standing ruling: 「an empty reply is worse than a wrong one,
because a wrong answer tells me something is broken and silence tells me nothing.」 A gate whose
failure mode is silence has reproduced the defect it was built against.

The plausible actions, in increasing cost, all deferred until the rate is known: log only ·
attach a provenance line naming the unsourced token · require the model to restate without it ·
refuse. **Refusal is last and needs its own GO.**

⛔ **And it must not be extended to 「is this about the business」 later.** That extension is the
prose detector, it would arrive wearing this gate's credibility, and it should be refused by
this paragraph when someone proposes it.

## What it still will not catch, stated so nobody reads it as more

A specific claim carrying **no token** — 「我們冇網站」 is an invention with nothing to check for
provenance. The gate is blind to it by construction, in the same way HR-68's duplicate detector
was blind to the un-duplicated rule. **It closes the numbered half of the failure, not the
failure.**
