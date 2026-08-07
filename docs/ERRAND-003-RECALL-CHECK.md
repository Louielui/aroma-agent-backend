# ERRAND-003 — the target that works end to end. **It delivers an answer.**

<!-- record-status: ACTIVE 2026-08-06 -->

> **Owner: 「find me a target that works end to end… where the six verbs actually deliver an
> answer rather than an honest stop. If no such target exists in my work, that itself is the
> finding.」**
>
> ## Such a target exists, and the answer is one a chef acts on.

**Caps: 12 browser actions, 150s, zero paid model calls. Used: 3 actions, 5.4 seconds, `$0.00`.**

---

# THE QUESTION: 「我入嘅貨有冇被回收?」

Canada's recall register — **public, no login, no bot mitigation (measured), and no usable
API**, which is exactly the shape HR-21 says the browser is *for*.

```
 1. navigate    ARRIVED    the Canadian recall register        HTTP 200
 2. read_page   READ       213 of 213 shown
 3. type        TYPED      textbox "Search" — 9 chars, shape text
 4. read_page   READ       214 shown          ← the composition rule, enforced
 5. click       CLICKED    button "Search"
 6. read_page   READ       156 of 156 shown
```

## The answer, for three things the Owner actually buys

**mushrooms**
```
2026-08-04  Food recall warning  Highline brand Organic Mini Bella Mushrooms Sliced — Listeria
2025-06-29  Food recall warning  Peeters Mushroom Farm brand Sliced Mushrooms — Listeria
2024-09-10  Public advisory      Imported raw Enoki mushrooms: safe food practices
2023-11-03  Notification         Planet Mushrooms brand Mushroom Soup Mixes — undeclared sulphites
```

**chicken**
```
2026-08-06  Notification         Compliments brand Smashed 100% Chicken Burgers — undeclared egg
2026-02-18  Notification         Boneless Chicken Thighs — semicarbazide
2026-03-19  Food recall warning  Salem Foods brand 7 Spices and Chicken Shawarma Spices
2025-10-07  Notification         Olymel brand Chicken Breast Strips — Salmonella
```

**cheese**
```
2026-08-03  Food recall warning  Coaticook brand White Cheddar cheeses — Listeria
2026-04-15  Food recall warning  Auricchio brand Taleggio D.O.P. — Listeria
2026-04-02  Food recall warning  Various brands of cheese products — Listeria
```

> ### The top mushroom result is TWO DAYS OLD. That is not a demo — it is the kind of thing that matters the week it happens.

---

# WHAT THIS SETTLES

| | |
|---|---|
| **does a working target exist in the Owner's work?** | **YES** |
| what it took | **3 actions, ~5 seconds, `$0.00`** per ingredient |
| what it needed that we did not have | **nothing** — no seventh verb, no new code, no login |
| Costco | confirmed a **ceiling**, not a verdict |
| `aroma-system` | confirmed the **wrong tool** (HR-21) — it has an API |

**Three errands, three different outcomes, and the six verbs reported all three honestly:**
an adaptive block, a login wall, and **an answer.**

## The machinery visible doing its job on a live page

- **The composition rule fired for real**: step 4 is a re-read the session guard requires
  between the `type` and the `click`. Without it the second act would have been refused.
- **The ambiguity warning fired on real content**: the register lists fourteen `StaticText
  "Recall"` labels, and the read marked them **「⚠ indistinguishable from 13 others on this
  page — do NOT choose between them」**. Nothing was hidden and nothing was picked. The errand
  targets the *links*, which are unique.
- **Document-order proximity carried the pairing** — each recall title is followed within a few
  lines by `<category> | <date>`, which is how the dates above were read. The property measured
  30/30 and now load-bearing.

---

# ⚠ WHAT THIS DOES NOT ESTABLISH

**One site, one shape of question.** A public register with a search box and a list of links is
the friendliest possible target after a static page.

- It does **not** show the verbs coping with a framework-rendered supplier portal.
- It does **not** test anything behind a login, which both other errands hit.
- The extraction leans on **document order**, which held here and would need re-checking on any
  layout that separates a title from its date. That is the same open corpus condition already
  recorded, still open.

**And the honest scope of the capability, after three errands:** she can reach and read
**public pages without programmatic surfaces**, reliably and cheaply. Everything the Owner
buys, orders, and pays for sits behind a login — **so the login question is not answered by
this, only deferred by finding real work that does not need it.**

> ### That is the finding to carry: the browser earns its place on the PUBLIC web. Its value inside the Owner's own operations is still gated on an identity decision he has not made, and today's result does not force it.
