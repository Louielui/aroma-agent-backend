# `type`, `wait_for`, `screenshot` — baselines measured BEFORE design. HR-18, third round.

<!-- record-status: ACTIVE 2026-08-06 -->

> **Owner: 「that is now two rounds where the honest baseline was more capable than the
> assertion, and type and wait_for are the most likely to be the same shape.」**
>
> ## They are. This round is short, and that is the finding.

---

# TYPING — measured

| probe | result | events fired |
|---|---|---|
| `fill()` over existing text | **replaced** — no manual clear needed | `focus input` |
| `pressSequentially` | **per-keystroke** | `keydown input` ×3 — framework-visible |
| **contenteditable** | **works** | `focus input` |
| textarea with a newline | **works** | |
| **readonly** | **REFUSED** | none |
| **disabled** | **REFUSED** | none |
| **text into `input[type=number]`** | **REFUSED**, and with a *named* error: `Cannot type text into input[type=number]` | none |
| `fill("")` | **clears** | |

> ### Everything the dependency argument claimed about typing — focus, replacing existing content, real input events, contenteditable — the library already does. We write none of it.

**And one thing is BETTER than `click`:** the number-input refusal carries a real message
rather than an opaque timeout. **`readonly` and `disabled` still time out silently**, so the
「name the reason」 gap is the same gap, in the same shape, for the same reason.

---

# WAITING — measured

| probe | result |
|---|---|
| `waitFor({state:'visible'})`, appears after 1.2s | **OK, 1325ms** |
| `waitFor` on something that never appears | **REFUSED, at the timeout** |
| `waitForFunction` — arbitrary condition | **OK, 841ms** |
| real page: `domcontentloaded` → `networkidle` | **239ms → 504ms** |

> ### `wait_for` is not a thing to build. It is a bounded pass-through with a stated timeout.

---

# SCREENSHOT — measured

| | |
|---|---|
| `page.screenshot()` | **73,822 bytes**, a real `Buffer` |
| `locator.screenshot()` (one element) | works — 171 bytes for a small input |

---

# ⚠ THE GAPS — and only two of them are new

## 1. `force` lies here too — HR-19

```
fill(readonly, { force: true })  ->  SUCCEEDED, and the field still reads "read only"
```

**The same flag, the same shape, a different verb, measured the same afternoon.** Structurally
absent in `type` exactly as in `click`.

## 2. Opaque refusals — the same gap as `click`

`readonly` and `disabled` both time out with the same message. The reason must be probed and
named, as `click` does.

## 3. ⛔ NEW, AND IT IS THE ONLY GOVERNANCE GAP IN THIS ROUND: typing is where secrets go

`click` moves a mouse. **`type` puts CONTENT into a page**, and the content may be a password,
a card number, or a customer's details.

Two things follow, and neither is a library concern:

> ### a. `input[type=password]` is REFUSED. Not redacted — refused.
>
> The standing rule is that credentials are never entered on the Owner's behalf. A verb that
> *can* type into a password field is a verb that will, on the day a login page appears
> mid-errand and the model reasons that logging in is the next step.

> ### b. The audit record NEVER carries the typed value verbatim.
>
> Length and a shape classification only. The record is durable and reviewable; a typed value
> in it is a secret in a log, and 「it was only a search box that time」 is not a property you
> can assert about future runs.

**This is the one place in this round where we add real behaviour rather than adapt.**

---

# WHAT THE THREE VERBS ARE

**Adapters. All three.** The round is short because the honest baseline was, for the third
time running, more capable than the assertion about it.

| verb | ours |
|---|---|
| `type` | force absent · password refused · value never logged · named refusal reasons |
| `wait_for` | a bounded pass-through that states its timeout and never waits forever |
| `screenshot` | bounded, and **never the primary record** — role + accessible name is |
