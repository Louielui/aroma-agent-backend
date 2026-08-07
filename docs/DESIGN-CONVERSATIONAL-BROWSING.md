# 對話式瀏覽 — she acts on 「去 X 睇下 Y」

<!-- record-status: ACTIVE 2026-08-07 -->

**DESIGN ONLY. No code exists.** Written to `docs/DESIGN-DOC-CONVENTION.md`: every requirement
carries `⛔ ENFORCED BY:`, and where nothing enforces it yet, it says `NOTHING YET` rather than
leaving the reader to assume.

Goal: she should handle 「去 X 睇下 Y」 the way she already handles a file-change request.

---

# 0. What this is, and the two things it is not

The browser verbs exist and work: `read_page`, `click`, `type`, `waitFor`, `screenshot`,
`navigate`, with L1 (payment stop), L3 (request fence), the origin policy, the composition rule
and the profile probes around them. ERRAND-003 runs daily on them.

**What does not exist is a way for a sentence to start one.** Every errand so far had its
origins written in advance, in code, by me.

> ### This is NOT: a general web agent. It is a way to START AN ERRAND from a sentence, where
> ### the errand is the thing that already exists and is already fenced.

> ### And it is NOT: a widening of what she may do. Every fence in §3 and §4 is one that
> ### already holds today. The only new thing is who names the destination.

---

# 1. What decides that a message is a browsing request

## The reason the file-change entrance works, stated first

`workRequestOffer.js` escapes M-5 (the classifier is non-deterministic on the same sentence)
for one reason and it is not cleverness:

> ## A file path is a LITERAL. `docs/canary/agent-canary.md` is a token that is either in the
> ## sentence or is not. There is no judgement to be unstable about.

A browsing request has that property only sometimes. So the entrance is a **three-way split**,
not a classifier.

| # | the sentence carries | decision | judgement involved |
|---|---|---|---|
| 1 | a **URL or domain-shaped token** + a browse verb | fires | **none** — same class as a file path |
| 2 | a **name in the written site registry** (§5) | fires | **mine, frozen, visible, dated** |
| 3 | neither | **does not fire** | none — it becomes an ordinary question |

**Case 3 is not a refusal and not a guess. She asks 「去邊個網?」 in conversation.** That is an
ordinary reply, not a classification, so it carries no M-5 exposure.

> **R1.1** The entrance fires ONLY on case 1 or case 2. No model call decides that a message is
> a browsing request.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `browseRequestOffer.test.js` → 「no model in the path」, asserting the module requires no LLM client and that a corpus of near-miss sentences produces no offer.

> **R1.2** It produces an **OFFER**, never an action. One sentence and a button, exactly as the
> file-change entrance does. A false trigger costs one glance: no session, no browser, no order.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `browseRequestOffer.test.js` → 「offer never launches」.

> **R1.3** The order is derived **server-side from the Owner's own message**, never from a
> body-supplied target. Same discipline as `workRequestRoute.js`: 「the browser supplies the
> message, never the target」.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `browseRequestRoute.test.js` → 「a body-supplied origin is ignored, not honoured」.

## ⛔ THE TENSION, RECORDED RATHER THAN RESOLVED

The Owner has said, about the file entrance: **「I am not going to learn a magic sentence.」**
And about this one: **「I would rather be told 「去邊個網?」 than have a classifier guess.」**

Both are true at once, and this design chooses the second at the cost of the first.

> ## 「去睇下我上次嗰張單」 WILL NOT WORK. That is the design, not a gap.

**Owner ruling, 2026-08-07:** *「if that turns out to be how I actually talk, that is a finding,
not a bug to patch with a model.」*

So the thing to watch is **how often case 3 fires**, and that is a measurement, not an opinion.
If he is routinely being asked 「去邊個網?」, the answer is not a classifier — it is either a
larger registry (case 2, still frozen and visible) or the honest conclusion that conversational
browsing does not fit how he speaks.

> **R1.4** Case-3 fall-throughs are COUNTED, so 「how often does this not work」 has a
> machine-counted denominator rather than an impression.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: an outcome-log counter, and `scripts/verify/` gains a line once there is a week of data.

---

# 2. What he sees while it runs

## ⛔ THE LOAD-BEARING QUESTION IS UNMEASURED, AND THIS SECTION STOPS HERE UNTIL IT IS

A browsing errand is 40–70 seconds and the browser is **headed**. Two unacceptable outcomes are
already ruled out by the Owner: a chat reply that pauses for a minute, and a wall of turns.

**But the design of the visible surface depends on a fact nobody has measured:**

> ## Does a headed Chromium launch steal keyboard focus on this machine, and does it steal it
> ## again on navigation?

- If it **does not** steal focus: headed is the better answer. He can see what she is doing, and
  the waiting bar carries the status line and the stop button. Visibility is free.
- If it **does** steal focus: a window that grabs the cursor mid-sentence is worse than one he
  cannot see, and the design changes — headless with a screenshot on completion, or a positioned
  off-focus window, and the waiting bar becomes the ONLY surface rather than a companion to a
  visible window.

**The measurement, specified so it can be run without re-deciding what it is:** launch the
errand's real browser with `launchOptions()`, type continuously into another window throughout,
and record (a) whether any keystrokes land in the browser, (b) whether the foreground window
handle changes, at launch and at each navigation. Ten launches, counted — one sample cannot
distinguish an effect from variance (M-5's lesson).

> **⚠ NOT RUN.** Running it would pop a browser window on the Owner's machine to find out
> whether browser windows interrupt him, which is the thing under investigation. It runs when he
> is not working, and it is the first thing this design needs.

## What is settled regardless of the outcome

> **R2.1** The errand is NOT a chat turn. The turn returns immediately with an acknowledgement;
> the errand runs asynchronously and produces ONE turn at the end carrying the conclusion.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `browseTurn.test.js` → 「the turn resolves before the errand does」.

> **R2.2** Live status appears in the **existing waiting bar**, which already persists above the
> thread across keystrokes. Running = 「我做緊嘢」; stopped = 「等你決定」. One surface, two states —
> not a new one.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `homeBriefingClient.test.js` → 「the running state renders in the waiting bar, not as a turn」.

> **R2.3** ⛔ There is a STOP control, and it is reachable for the whole run. A browser moving on
> his machine that he cannot stop is worse than no visibility at all.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `browseSession.test.js` → 「stop is honoured mid-errand and records STOPPED_BY_OWNER」.

> **R2.4** The status line comes from the errand's existing `note()` callback. No second source
> of truth about what step it is on.
> ### ⛔ ENFORCED BY: `NOTHING YET`.

---

# 3. Which profile — 「唔係唔准問，係冇地方問」

> ### THE CONVERSATIONAL ENTRANCE CANNOT EXPRESS 「use the logged-in profile」. There is no
> ### parameter. The question has nowhere to arrive.

The Owner asked what stops a public-page errand reaching for his credentials because a rule
matched loosely. The answer is that **there is no rule to match**:

| | |
|---|---|
| the conversational entrance | reaches **one** session constructor — ephemeral, profile-less |
| the credential profile | reachable **only** through an order he approved that names it, which is a different entrance (§4) |

This is the same shape as `scheduledRun.js`'s read-only gate, and it is the shape the Owner has
approved twice: **「唔可能」，唔係「唔准」**.

> **R3.1** The conversational path constructs its session through a constructor that takes no
> profile argument. Adding one is a code change, reviewable, not a runtime decision.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `browseSession.test.js` → 「the conversational constructor has no profileDir parameter」, greping the module for `profileDir` and `browser-profile` the way `recallCheck.test.js` already does (HR-29).

> **R3.2** Selection is never inferred from the destination. There is no 「this site needs a
> login, so use the profile」 branch, and there never is one.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: the same structural grep; a branch on the destination cannot exist if the parameter does not.

---

# 4. What needs approval — capability, not category

## ⛔ THE LINE IS NOT READ VS WRITE

The Owner's objection is the whole argument and it is correct: **「reading is safe」 is a
judgement, and the Costco order area was reading too.**

> ## What made the Costco case dangerous was not that it was reading. It was that it was
> ## **用你身分讀** — reading while wearing his identity.

That is why the profile sits on the approval side of the line and plain reading does not. The
line is drawn on **what capability the session carries**, and both halves are already enforced
by absence rather than by a rule:

| capability | already enforced by |
|---|---|
| can it write? | **L3** — non-GET is denied unless the sealed order named it, and a conversational order names none |
| does it carry his identity? | **the profile** — §3, unreachable from this entrance |

> **R4.1** An errand whose order permits no writes AND carries no credential profile needs no
> approval. Its worst case is bounded by construction: GET on allowed origins, nothing else.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `browseOrder.test.js` → 「a conversational order has allowedWrites: [] and cannot be given any」.

> **R4.2** Any order that names an allowed write, OR the credential profile, OR both, produces a
> sealed work order and waits — the same path a file change takes.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `browseOrder.test.js` → 「an order with a write goes through proposeWorkOrder」.

> **R4.3** The government submission blocklist is checked BEFORE the allowlist, on the order AND
> on every navigation, exactly as today. It is never a pattern; it is 12 reviewed surfaces.
> ### ⛔ ENFORCED BY: `src/browser/wiringSmoke.test.js` → 「THE GOVERNMENT BLOCK IS LIVE INSIDE navigate() — and an order cannot lift it」. **Already enforced**, and it asserts the strong form: a CRA origin is refused *even when the order explicitly names it*, and refused for the same reason whether named or not.

## What this does NOT claim

Prompt injection can still make her do things **within** her capability — which is GET on allowed
origins. The blast radius is 「she reads a different allowed page」. That is bounded, and it is not
nothing. See §6.

---

# 5. The order allowlist — and this one is a JUDGEMENT GATE, not a wall

## Why the construction step has no good answer

Something must turn 「去 X 睇下 Y」 into `{ allowedOrigins: [...] }`. Four candidates, three
rejected:

| candidate | verdict |
|---|---|
| the model resolves the name | ⛔ M-5. And what would be unstable is **the fence**, not a reply. |
| a search engine resolves the name | ⛔ worst. The fence would be authored by a page nobody has read. |
| a registry I write | this is 「written in advance」 with a different name — **but honestly so** |
| ask once, then remember | ⛔ this is追認, not construction — and it trains a reflex yes |

> ## Owner ruling, 2026-08-07: 「she can browse in conversation only to origins written in
> ## advance」 is a legitimate outcome, and better than a mechanism that lets a sentence author
> ## its own fence.

**Accepted.** The registry is the mechanism, and the confirm-once flow exists only to grow it
with his decision, never to bypass it.

## The shape

1. **URL/domain in the sentence** → zero construction. The token IS the origin.
2. **Name in the registry** → resolved from a file in the repo he can read: origin, the date it
   was added, and the sentence that introduced it.
3. **Neither** → she asks 「去邊個網?」 (§1 case 3).

When he names an origin that is not in the registry, she asks once, in conversation, and on his
answer adds it — with provenance — before the errand starts.

> **R5.1** An origin enters the registry only through an explicit Owner answer, recorded with the
> date and the sentence that introduced it. Never inferred, never added by a page.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `siteRegistry.test.js` → 「an entry without provenance is refused」.

> **R5.2** One order per errand, sealed at the start, never widened mid-errand. A link on site A
> pointing at B is not followed.
> ### ⛔ ENFORCED BY: `src/browser/navigate.test.js` → `checkNavigation` per-navigation origin tests, including the lookalike case (`costco.ca.evil.com` is refused against an order naming `costco.ca`). **Already enforced.**

> **R5.3** Page content can never construct or widen an order.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `browseRequestRoute.test.js` → 「the order is derived from the message only」.

## ⛔ AND IT IS LABELLED FOR WHAT IT IS

> ### The confirm-once step is a JUDGEMENT GATE, not a structural one.

**Owner's standing rule: 「a fence I can reason past is a preference.」** This one he explicitly
cannot make structural, and this paragraph exists so nobody later reads the registry as a wall.

It reduces accidental and injected origins. **It does not make an arbitrary page safe to read.**
The structural guarantees remain exactly three, and they are the ones in §3 and §4:

> **GET only · no credentials · government surfaces blocked by name**

Everything else in this section is a preference, honestly labelled.

---

# 6. ⛔ THE UNMITIGATED PART

**Its own section, at the Owner's instruction, because it is not a caveat.**

> ## A page she reads can influence how she reports to him. Nothing structural prevents this.

Already recorded as unmitigated in the logged-in browsing round. What this design does is make
it **worse**, and the word is deliberate:

| before | after |
|---|---|
| the set of pages that can attempt it = **origins I wrote in code** | = **origins he names in passing**, plus whatever the registry accumulates |

## Why this one matters more than the others

**It is the HR-35 twin getting worse, at the only layer he cannot audit.**

HR-35: report what the source returned; a second filter on top of a search is invisible and its
failure mode is silence. HR-41 named the twin: **my report to him IS a filter on what I found**,
applied where nothing counts the denominator. Conversational browsing enlarges the set of inputs
to exactly that filter.

He named this himself: **「the HR-35 twin is the one that matters most, because it is the one I
cannot check.」** This design increases its exposure and does not reduce it.

## The only mitigation, and it is partial

> **R6.1** A browsing errand's report is STRUCTURED, not prose: the origin, what was asked, and
> extracted values in fixed fields. Text from the page never becomes a recommendation.
> ### ⛔ ENFORCED BY: `NOTHING YET` — planned: `browseReport.test.js` → 「the report carries no free-text field sourced from the page」, and a corpus test that an instruction-shaped page produces the same report shape as an ordinary one.

This is the same discipline ERRAND-003 already follows: it reports date and title, never the
page's words as advice. It narrows the channel. **It does not close it.**

> **R6.2** This section is reviewed whenever the registry grows past a size where he would stop
> reading it — a threshold to be set by measurement, not by feel.
> ### ⛔ ENFORCED BY: `NOTHING YET`.

---

# 7. Out of scope, stated so it is not proposed later

- **Anything that writes**, on any site. §4 routes it to a sealed order; nothing here does it.
- **The logged-in profile**, from this entrance, ever. §3.
- **Multi-step errands that browse to a site named by a previous page.** §5 R5.2.
- **A model classifier for browse intent**, including as a fallback for case 3. §1.
- **Paid model calls inside a browsing errand.** ERRAND-003 costs `$0.00` and so does this.

---

# 8. Build order, once §2 is measured

| # | build | gate |
|---|---|---|
| 0 | **the focus measurement** (§2) | must happen first; it decides §2's surface |
| 1 | the site registry + its provenance test (§5) | — |
| 2 | the deterministic entrance + offer (§1) | no model, offer only |
| 3 | the ephemeral-only session constructor (§3) | structural grep test |
| 4 | the waiting-bar running state + stop (§2) | shape depends on step 0 |
| 5 | the structured report (§6) | — |

**Nothing in this document is built. Every `NOTHING YET` above is honest.**
