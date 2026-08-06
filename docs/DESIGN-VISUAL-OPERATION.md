# Visual computer control with a reviewable action record

<!-- record-status: ACTIVE 2026-08-06 -->

**RECON AND DESIGN. No code, nothing built.** 2026-08-06.

> **Owner, opening the evaluation:** 「I have been arguing against visual operation and I was
> wrong about why. The objection was never 『visual versus API』. It was 『does the action leave
> a verifiable trace』. **A worker with an API and no audit is less safe than a worker driving
> a screen with a complete one.**」

That reframe is correct, and it is worth stating precisely because it is doing real work
below: **the evidentiary class of a trace matters more than the modality of the action.** An
API worker that reports its own success is *attesting*. A visual worker whose browser
produces the artefacts is *observed*. Those are different kinds of evidence, and the second
is stronger — which is exactly the `observed-by-us` versus `attested-by-them` distinction
already recorded in `DESIGN-WORKER-ADAPTER.md`.

---

# 1. THE ACTION SET — how large, honestly

## What exists, measured

```
aroma-3b  src/computer/computerExecutor.js:43
    const ACTIONS = Object.freeze(['open_app', 'type_text', 'save'])
```

| | measured |
|---|---|
| actions implemented | **3** |
| `src/computer/` non-test modules in `aroma-3b` | **24** |
| the same directory in the backend | **10** — and all ten have diverged |
| browser verbs (`navigate`, `click`, `querySelector`) anywhere in either repo | **0** |

**The canary was Notepad.** Nothing in this codebase has ever driven a browser.

## Does 「larger than Computer Operator」 still hold? — NO, AND THE REASON IS THE DECISION

The earlier estimate was made against a different goal. **It assumed we would build the
action set.** Building `navigate` / `click` / `read_page` / `wait_for` / `screenshot` /
form-fill across arbitrary sites *is* larger than the Computer Operator wire-in, and it is
per-site brittle in the way `BACKLOG-002` already demonstrated with a single Notepad save.

**The existence proof changes the question.** Claude in Chrome already has that action set.
So the work is no longer 「build browser automation」; it is:

| what would actually be built | kind |
|---|---|
| the sealed-order shape for browser work | governance |
| the fence, and a probe that can verify it | governance |
| audit capture, redaction, retention | governance |
| the dispatch and return path | plumbing |

> ### Adopt a driver → SMALLER than Computer Operator's remaining wire-in.
> ### Build a driver → LARGER, and it was larger before for the same reason.

Computer Operator's remainder is **14 missing modules plus 10 diverged ones, each needing a
written adjudication**. The governance list above is smaller than that, and none of it is
UIA-shaped guesswork.

**⚠ One thing NOT measured, and it decides this:** whether Claude in Chrome exposes any
programmatic dispatch surface her backend could call. **I have not verified that it does.**
If it is only human-driven, then 「adopt a driver」 is not available and the estimate reverts
to the larger one. That is the first thing to establish, before any of the design below is
worth acting on.

---

# 2. WHAT THE AUDIT MUST RECORD

> **Owner: not 「it clicked at 400,300」.**

Coordinates are the worst possible record: they are unstable across window sizes, meaningless
a week later, and they do not say what was clicked.

## The record, per step

| field | why |
|---|---|
| `url` + page `title` | **where**. Without it nothing else can be located |
| `role` + `accessibleName` of the target | **what** — 「button: 加入購物車」. Survives a redesign that moves it 200px |
| `intent` | the step's purpose from the sealed order, not the model's narration |
| `valueShape` for typed text | **length and class, not content** — see redaction below |
| `beforeDigest` / `afterDigest` | a hash of the page's accessible tree. **What changed**, without storing what it said |
| `outcome` | succeeded / element-not-found / timed-out / refused-by-fence |

## What is reconstructible, and what is not

**Reconstructible:** the sequence, the pages, the elements by name, whether the page changed,
and where it stopped.

**NOT reconstructible, and this must be stated rather than implied:**
- **what the model actually saw** — the rendered pixels, unless screenshots are kept;
- **why it chose that element** — the reasoning is not in the trace, and a plausible
  reconstruction after the fact is a story, not a record;
- **what the page contained** — a digest proves change without preserving content, which is
  the privacy trade taken deliberately.

## ⚠ SCREENSHOTS — highest value, highest risk, and `windowTitle` is the precedent

`windowTitle` was removed from the audit because **a window title can carry a customer name**.

> ### A screenshot of a logged-in page does not carry a customer name. It carries the customer list.

And the decisive fact, already true today: **`.aroma/computer-audit/` mirrors to Backblaze
nightly.** So a screenshot is not a local screenshot. **It is an offsite screenshot**, and
that has to be a decision someone makes, never a side effect of enabling a feature.

**Proposal — screenshots are the exception, not the default:**

1. **Default: no screenshot.** The DOM-derived record above.
2. **On failure** — one screenshot, because a failure that cannot be seen cannot be
   diagnosed.
3. **On any `effect`-class action** — one screenshot **cropped to the acting element**, not
   the viewport.
4. **Never on a page matching a redaction list** (payment, credentials, anything the Owner
   names).
5. **Short retention, and separate from the metadata record** — so the trace survives while
   the pixels expire.
6. **`valueShape` never stores what was typed** into a field classed as secret. `len=16
   class=card` is a record; the number is a liability.

---

# 3. THE FENCE QUESTION — the real one

> **Owner's instinct:** 「an audit tells me what happened, it does not make anything
> impossible. So visual operation is admissible for reading and navigating and permanently
> refused for anything that spends or signs.」

## The conclusion is right. The reasoning needs one correction and one refinement.

### The correction: an audit is not worthless for admissibility — it is worthless *here*

An audit is a **detection** control. The entry rule is about **prevention**. Saying 「audit
does not make anything impossible」 is true but slightly too strong as a general claim,
because there is a case where detection genuinely substitutes for prevention:

> ## An audit changes admissibility exactly when it enables REVERSAL INSIDE THE DETECTION WINDOW.
>
> If the action can be seen **and undone** before consequence lands, detection ≈ prevention.

That case exists and is not hypothetical:

| action | reversible within detection? |
|---|---|
| navigate, read | nothing to reverse |
| fill a form without submitting | **yes** — close the tab |
| post a comment / send a message | **compensable** — deletable, but seen |
| **place an order** | **no** — 「maybe cancellable, maybe with a fee, maybe not at all」 |
| **pay, sign, authorise** | **no** |

### The refinement: the line is REVERSIBILITY, not read-versus-write

Drawn as 「reading and navigating admissible, spending and signing refused」, the rule is right
in outcome and slightly wrong in mechanism — and the mechanism is what will be applied to the
next case nobody has thought of yet.

> ### The honest line:
> **Admissible while the worst outcome is reversible within the window in which the audit is
> actually read. Refused permanently once it is not.**

**It lands exactly where the Owner drew it for spend and sign**, and it also correctly admits
「fill the form, stop before submit」 — which read-vs-write would have refused, and which is
most of the practical value.

### ⚠ AND THE THING WORTH ADDING — a good audit on an irreversible path is WORSE than none

`GOVERNANCE-BROWSER-VS-FILE.md` already recorded what the audit captures on a browser order:

> *「we clicked submit.」* **The order lives on their servers, not in our record.**

That row is **complete**. Every field is populated, every field is true, and the money is
gone. A thorough audit there does not merely fail to help —

> ### it makes an ungoverned path FEEL governed, which is how it gets used.

That is the same failure as `basis` with unreachable branches, as a deny rule that never
matches, as `count: 43`. **A control that reads as protection while providing none is the
defect class this project has spent a week removing**, and a beautiful action record on a
Place Order button is exactly that shape.

## So: is anything missing from the Owner's conclusion?

**One thing, and it constrains the ADMISSIBLE half rather than the refused half.**

Reading and navigating **as him** is still case 3. His session can be used to read things he
would not have chosen to expose — and the audit would faithfully record that too, after the
fact. So the admissible half **still needs an environmental fence**, not just an audit:

| fence | verifiable by us? |
|---|---|
| a profile with **no payment method** | **not from outside** — this is why the browser was refused in the first place |
| a profile **scoped to allowed origins** | **yes, if we build the profile** — and this is the one that makes the read half admissible |

> **The read half is admissible only if the profile is ours to construct.** Driving his
> everyday logged-in browser is not the same proposition as driving a profile built for the
> purpose, even for reads — and the difference is exactly the entry rule.

---

# 4. WHAT IT MEANS FOR THE SEQUENCE

> **Owner: does the worker adapter still come first, or does this replace part of it?**

## It does not replace it. It INSTANTIATES it — and it improves the first test

The worker adapter is the contract; visual operation is a worker that must pass it. Nothing
above weakens the contract — §3 is the entry rule doing its job, and reaching a *finer* answer
than 「refused」.

**But it changes what the first test should be, and this is a real improvement on my own
design.**

`DESIGN-WORKER-ADAPTER.md` proposed: admit Claude Code in a no-remote clone, and register the
browser **the same day, specifically to be refused**. One worker admitted, one refused.

> ### A contract that refuses a whole WORKER is coarse.
> ### A contract that admits and refuses the SAME worker depending on the ACTION is the one that proves `resultKind` and the fence do any work at all.

Visual operation is that case: **admitted for navigate and read, refused for submit and pay,
by the same fence, in the same dispatch.** If the contract cannot make that distinction it is
not a contract — and a coarse pass/fail test would never have found out.

## Revised order

| # | | why |
|---|---|---|
| 0 | **verify Claude in Chrome exposes a dispatch surface** | unmeasured, and it decides whether §1 is the small estimate or the large one |
| 1 | **the worker adapter contract** — still first | it is what everything else is judged by |
| 2 | **first test = the visual worker, both halves** | admitted for read/navigate, refused for effect. Finer than the pair I proposed |
| 3 | Claude Code in a no-remote clone | still the safest real work, and still case 1 |
| 4 | Computer Operator | **weakened further.** It was already 「buys isolation, not capability」; a visual driver that already exists makes its remaining 14 modules harder to justify |

## And the honest answer to 「does this cover what I wanted from Manus and from browser automation?」

**Most of the reading half, none of the acting half.**

- **Supplier portals, price checks, order status, anything that is 「go look and tell me」** —
  yes, and that was always the larger share of the value.
- **Placing orders** — no, permanently, and the Costco measurement already showed that half
  was worth less than it looked: four actions against six classes of judgement per line.
- **Manus** — unchanged. It is case 2, admissible for assertion-shaped work only, and a
  visual worker does not touch that ruling.

> ### The line arrived at here is the same line as Costco, from the other direction — and that agreement is the strongest evidence either of them is right.

---
---

# STEP 0 — MEASURED 2026-08-06. Answer: NO DIRECT PATH. One indirect path, one unknown.

**Owner: 「You said it decides everything, so it goes first and nothing is designed around it
until it is answered.」** Measured, read-only, nothing built.

## Direct dispatch surface: NONE ON THIS MACHINE

| check | result |
|---|---|
| `mcpServers` in `~/.claude.json` | **absent** |
| `mcpServers` in `~/.claude/settings.json` | **absent** (only `theme`) |
| a local listening port belonging to a Claude/Chrome bridge | **none** — `7768` is Spotify, `8081` is the A6 service, `8090` is her |

So `claude-in-chrome` is **surfaced by the Claude Code host to the agent it runs**, not by an
addressable service. **Her backend has nothing to call.** That is measured, not inferred from
documentation.

## The indirect path EXISTS, and it is one line wide

The Agent Bridge already spawns the real CLI:

```js
// src/agent/agentBridgeWorker.js:39
function buildAllowedTools () { return ['Read', 'Edit', 'Write'] }
// …:142
'--allowedTools', buildAllowedTools().join(' ')
```

**She already dispatches to Claude Code.** Reaching visual operation would not need a new
transport — it would need browser tools in that array.

### ⚠ AND THAT ARRAY IS CURRENTLY A REAL FENCE

Three tools, granted explicitly. The bridge cannot drive a browser **because the capability
was never handed to it** — not because a rule forbids it.

> ### Adding browser tools to `buildAllowedTools()` converts that fence from 「impossible」 into 「granted, and governed by something else」.
> **That is the mechanism-to-intention degradation, in one line, in our own code.**

It is the same shape as the remote and the browser before it. If visual operation is ever
admitted, **the grant must be per-sealed-order — never a widened default** — or the fence
that is doing real work today stops existing for every dispatch, including the ones nobody
reviewed.

## THE REMAINING UNKNOWN, and it is the whole of step 0

**Whether a headless `claude -p` subprocess can reach browser tools at all.** The
`mcp__claude-in-chrome__*` tools are surfaced in an interactive session; whether they exist
for a spawned CLI run is **not determinable from this machine by inspection.**

There is a signal pointing at 「no」: interactively-authenticated MCP servers may simply be
absent in headless runs. **A signal is not a measurement, and I am not treating it as one.**

### How to settle it — one experiment, and it costs a paid call

Spawn `claude -p` with a browser tool named in `--allowedTools` and a goal that requires it;
read whether the tool was available or refused. Cheap, read-only, and decisive.

**It is a paid model call, so it is the Owner's to authorise.** Not run.

## Consequence for the estimate, stated plainly

- **If the headless CLI has browser tools** → the small estimate holds. The transport already
  exists; what remains is governance.
- **If it does not** → 「adopt a driver」 is not available on this machine today, and §1 reverts
  to the larger estimate: building the action set.

**Nothing beyond this is designed. Nothing was built.**
