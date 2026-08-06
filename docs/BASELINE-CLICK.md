# `click` — the baseline, measured BEFORE the design. HR-18 applied to itself.

<!-- record-status: ACTIVE 2026-08-06 -->

> **Owner: 「read_page turned out to be more capable than asserted; do not assume click must be
> built from nothing without checking what playwright-core already does correctly with a ref we
> can resolve.」**

The dependency was approved on the argument that a correct click needs scroll-into-view,
covered-element detection, stability, frame resolution, hit-point maths and trusted event
order — and that hand-rolling those is where we would be right on the sites we tested and
wrong on the rest. **That argument had never been measured. It has now.**

Local HTML fixtures, one hazard each. No live site was clicked to answer a question a fixture
can answer.

---

# WHAT PLAYWRIGHT ALREADY DOES — we build none of this

| probe | result | |
|---|---|---|
| plain button | **CLICKED** | `isTrusted: true` — a real event, not a synthetic dispatch |
| **offscreen, 1600px down** | **CLICKED** | scrolled into view by itself |
| **covered by an overlay** | **REFUSED** | waited, then gave up. It will not click through something |
| **moving (animating forever)** | **REFUSED** | waited for stability that never came |
| **disabled** | **REFUSED** | |
| **inside an iframe** | **CLICKED** | via `frameLocator`, `isTrusted` in-frame |

> ## The dependency argument holds, and it is now evidence rather than reasoning. Five of six hazards are handled by the library, correctly, with no code from us.

**So `click` is not a build-from-nothing.** It is a thin, careful adapter — which is the same
shape HR-18 found for `read_page`, and the second time in two rounds that the honest baseline
was more capable than the assertion about it.

---

# ⚠ WHAT IS LEFT FOR US — three gaps, each measured

## 1. `force: true` SILENTLY CLICKS THE WRONG THING

```
COVERED + force:true   ->  NO_EFFECT   call returned but nothing was clicked
```

**No error. No exception. The call succeeded and the button was never clicked** — the overlay
received the event instead.

> ### This is the worst failure shape in the codebase, in a library flag: an action that reports success and did something else.
>
> `force` bypasses exactly the actionability checks that make the refusals above trustworthy.
> **It must be structurally impossible to pass**, the same way `headless` is — not a
> discouraged option.

## 2. `DOM.resolveNode` RESOLVES A NODE THAT NO LONGER EXISTS

```
element removed from the DOM
  DOM.resolveNode on the removed node  ->  RESOLVED ANYWAY
  the tagged locator now finds         ->  0 element(s)
  clicking the stale ref               ->  refused (timeout)
```

**A stale ref does not fail at resolution.** The safety comes entirely from going
*ref → tag the node → locate by attribute → click*, because the locator finds nothing and
refuses.

> ### So the resolution path is not an implementation detail, it is the staleness check.
>
> A 「more direct」 implementation — `DOM.resolveNode` then `Runtime.callFunctionOn` to call
> `.click()` — would act on a **detached node** and report success. That is the same shape as
> `force`, reached by a different route, and it is the tempting optimisation.

## 3. A REFUSAL IS AN OPAQUE TIMEOUT, NOT A REASON

Covered, moving and disabled all produce the identical message:

```
page.click: Timeout 4000ms exceeded.
```

**Nothing in the error says which.** For a report that has to tell the Owner 「撳唔到,因為…」,
that is not enough, and the report is the only remaining review (`DESIGN-DISPATCH-PATH` §5).

**This is the one place we must add real behaviour:** on refusal, probe the element's state —
covered by what, disabled, not stable, not in the DOM — and say which. **Playwright knows why
it gave up; it just does not tell us, so we ask afterwards.**

---

# ⚠ AND THE HARNESS ITSELF WAS WRONG TWICE BEFORE IT WAS RIGHT

**Recorded because the numbers above would have been false, and confidently so.**

| version | what it measured |
|---|---|
| first | the overlay auto-removed after 2.5s and the first probe took 2.7s, so **「covered」 was clicked on an uncovered button**; the animation was 1.2s and had finished, so **「moving」 was clicked on a still button**; the iframe row reported **the previous probe's click**, because reading 「last entry」 cannot tell a new click from no click |
| second | hazards made permanent, `__clicks` cleared per probe, no-new-entry reported as `NO_EFFECT` — but `postMessage` is **async**, so the frame probe read too early and its message landed during the *next* probe, mislabelling that one |
| third | settle before reading. The table above |

**Three of six rows in version one were meaningless, and every one of them read as a clean
result.** This is HR-15's family again — *a measurement instrument that has never been checked
against a result you disbelieve* — and it is the fourth time this week that building the
measurement was where the bug was.

---

# WHAT THIS MAKES `click` INTO

**Not a verb to implement. An adapter over a library that already refuses correctly**, plus:

1. **ref → element**, measured working: `DOM.resolveNode` → tag with a unique attribute →
   `page.locator('[data-aroma-ref=…]')`. **This path is the staleness check and must not be
   shortened.**
2. **`force` structurally absent**, like `headless`.
3. **A refusal that states its reason**, because the library's does not.
4. **The stop, unchanged**: allowlist not denylist, no submit verb, and an origin the order did
   not name is a halt rather than an error to retry.
