# Track B — the browser action set

<!-- record-status: ACTIVE 2026-08-06 -->

**PLAN ONLY. No code until the Owner rules on the dependency.** 2026-08-06.

---

# 0. TRACK A IS CLOSED, NOT DEFERRED

> **Owner: 「the absence is structural, not a missing feature.」**

Measured 2026-08-06: the browser capability reaches the extension from the **desktop app**
through `chrome-native-host.exe`, and **not over MCP**. The only invocable entry points are
`claude://` and `claude-cli://` — **launch mechanisms with no return channel.**

**A fire-and-forget URL scheme cannot become a dispatch path by being tried harder.** There is
nothing to wait for, nothing to parse, no cost, no turns. It is not a missing feature that a
future version might add for us; it is the shape of what a URL scheme is.

**CLOSED.** If a supported request/response surface ever appears, that is a new question with
a new measurement — not this one reopening.

---

# 1. DECISION ONE — the dependency

## The purity option is real, and that is why it needs answering honestly

Node here is **v24.18.0**, which has a global `WebSocket`. So hand-rolling CDP genuinely
would add **zero** dependencies. The 「no new dependencies」 rule could be kept.

**What it would cost is not the transport.** `Accessibility.getFullAXTree` is one CDP call;
`Input.dispatchMouseEvent` is another. The transport is a weekend.

> ### What is NOT a weekend is `click`.
>
> A correct click must: scroll the element into view, confirm it is not covered by an
> overlay, confirm it has stopped moving, resolve the right frame, compute the hit point, and
> dispatch trusted events in the right order. Every one of those is a place a hand-rolled
> version is **subtly wrong on some sites and right on the ones you tested**.

That is the same failure this project has spent a week removing: something that works on the
sample and is wrong in the population.

## The proposal: `playwright-core`

**Measured from the registry, not recalled:**

| | `playwright-core` **1.62.1** | `puppeteer-core` 25.5.0 | `chrome-remote-interface` 0.34.0 |
|---|---|---|---|
| runtime dependencies | **NONE — no `dependencies` field at all** | **6** — ws, chromium-bidi, devtools-protocol, @puppeteer/browsers, typed-query-selector, webdriver-bidi-protocol | 2 — commander, `ws@^7` (a major version behind) |
| postinstall script | **none — no `scripts` field** | `@puppeteer/browsers` is a browser downloader | — |
| unpacked | 13.4 MB | — | — |

### Why that one

1. **Zero transitive tree.** One package to audit, one version to pin, one changelog to read.
   `puppeteer-core` brings six direct dependencies and their descendants.
2. **No postinstall.** Nothing executes at install time and nothing downloads a browser. That
   is the difference between reviewing a package and reviewing a package *plus whatever it
   fetches on your machine*. (`playwright`, the wrapper, is what downloads browsers —
   `playwright-core` is deliberately the one that does not.)
3. **It connects to an EXISTING Chrome** over CDP rather than shipping one, which keeps the
   browser the Owner's, in a profile we construct — the fence from
   `DESIGN-VISUAL-OPERATION.md` §3.
4. **`page.accessibility.snapshot()` exists**, which is decision two's whole subject.

### What it pulls in — the honest list

**Nothing at runtime.** 13.4 MB of vendored code inside one package, including a bundled copy
of the protocol types and its own driver. It is *large*, and largeness is a real cost — but it
is **one thing**, and one thing is what an audit can hold.

### The audit surface, concretely

- **pin exactly** (`1.62.1`, no caret) — a browser driver is not a package to float;
- **`npm ci` from the lockfile only**, never `npm install <pkg>` in a running system;
- it is required **only** by the browser worker module, never at the composition root, so with
  the flag off it is never loaded;
- upgrades are a reviewed change with the changelog read, not a routine bump.

**I have not installed it. Nothing has been added to `package.json`.**

---

# 2. DECISION TWO — `read_page`, and how it avoids being endlessly nearly-done

> **Owner: 「that sounds like the kind of thing that is either done or endlessly
> nearly-done.」** Correct, and the fix is to define done as a measurement before starting.

## What 「an accessibility tree a model can act on」 actually means

**Not the DOM.** A Costco results page is thousands of nodes, almost all layout.

The accessibility tree carries **role + accessible name + state** — `button "加入購物車"`,
`link "Bounty Paper Towels"`, `checkbox checked` — which is the vocabulary a model reasons in
and, crucially, **the vocabulary the audit already requires** (`DESIGN-VISUAL-OPERATION.md`
§2 records role and accessible name, never coordinates).

But a raw AX tree is still far too large. 「Actionable」 means four things:

| requirement | why |
|---|---|
| **pruned** | presentational and unnamed nodes removed. What survives is what a person could point at |
| **referenced** | every surviving node carries a stable `ref` so a later `click` targets *that node*, not a re-found guess. **This is what makes coordinates unnecessary** |
| **bounded** | a page must serialize to a budget, and when it is cut it must SAY it was cut — the same rule as every other read |
| **stable within a turn** | a ref taken from a read must still mean the same node when the click happens, or fail loudly rather than click something else |

## How we would know it is good enough — a frozen corpus, decided in advance

**The bar is set before the work starts, and the corpus does not grow during it.** That is the
only thing that turns 「nearly done」 into 「done」.

**The corpus:** ~10 real pages, saved as fixtures so they cannot drift — a Costco search
result, the Canva editor, a supplier portal login, an IG composer, a Drive folder listing, and
a few deliberately awkward ones (an infinite-scroll list, a modal over content, an iframe).

**The questions:** a fixed list per page with known answers — *「which ref adds the third
result to the cart?」*, *「what is the price shown on that tile?」*

**The bar:**

> - **≥ 90%** of targets identified correctly from the `read_page` output alone;
> - **100%** correct refusal on the **absent-target** questions.

### ⚠ The second number is the one that matters

**A corpus with no absent targets can be passed by a model that always guesses.** So a fixed
share of the questions ask for something that is *not on the page*, and the only passing
answer is 「it is not here」.

That is HR-12 as an acceptance criterion: **a benchmark that cannot fail is not a benchmark.**

**And the anti-endless rule:** when the bar is met on the frozen corpus, `read_page` is DONE.
A new awkward page found later is a **new corpus entry for a future round**, not a reason the
current one is unfinished.

---

# 3. DESIGN FOR THE STOP — the thing being built is not an errand-runner

> **Owner: 「the target is 『she operates it and stops before anything irreversible』, not 『she
> completes the errand』. Design for the stop.」**

The Costco measurement stands: **four actions to Add to Cart against six classes of judgement
a selector cannot make** — wrong category, wrong product, fulfilment channel, stock, price,
pack size. **Track B buys hands. It does not buy judgement.**

So the stop is not 「she judges correctly and refrains」. That would be an intention.

> ## The sealed order NAMES what she may act on. Anything else HALTS.
>
> Not a forbidden list — an **allowed** list. The default is stop; proceeding is the
> exception, and the exception is written down before she starts.

Concretely, and reusing machinery that already exists:

- the order carries the **permitted action classes and target roles** for this dispatch;
- an action outside them ends the enquiry as **`BLOCKED_NEEDS_YOU`** — an outcome already
  built, already rendered on the report's first line;
- **there is no `submit` verb.** `click` exists; a click on a target not named in the order
  does not.

**The success case for the first version is a HALT**, not a completion: she navigates,
reads, fills, and stops at the last button with a report saying what she was about to do.

---

# 4. OFFLINE STAYS SEPARATE

> **Owner: 「They shared a name, not a codebase.」**

| | online / browser | offline / desktop |
|---|---|---|
| estimate | 1–2 months | **3–6 months, evidence supports the high end** |
| evidence | none yet | `aroma-3b`: **24 modules, 3 actions**; `BACKLOG-002` closed as evidence-not-sufficient |
| mechanism | CDP | Windows UIA |
| code | new module, this repo | `aroma-3b`, unwired |

**They must not share a flag, a module, or a progress report.** Anything that says 「computer
operation: N% done」 across both is a number that hides the hard half behind the easy one.

---

# 5. THE ACTION SET — planned, not built

| verb | what it does | the part that is not obvious |
|---|---|---|
| `navigate` | go to a URL | must refuse an origin not named in the order |
| `read_page` | the pruned, referenced AX tree | **decision two.** The real work |
| `click` | act on a **ref**, never coordinates | actionability: in view, not covered, stable, right frame |
| `type` | text into a ref | must record `valueShape`, never the value, for secret-classed fields |
| `wait_for` | a condition, not a sleep | a timeout is an OUTCOME, not a retry-until-true |
| `screenshot` | the exception, not the default | failure only, or a cropped `effect` action. It mirrors offsite nightly |

**Order of work:** `navigate` + `read_page` first and alone, against the frozen corpus. The
other four are small once a ref means something; **they are meaningless before it.**

**Nothing is built. No dependency has been added.**
