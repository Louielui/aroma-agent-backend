# canary-work-order.draft.json — SUPERSEDED, NEVER EXECUTED

**Status:** superseded 2026-08-02 by Owner decision. **Not executed under final scope.**
**Do not modify it. Do not reuse it. Do not reuse any approval taken against it.**

## What it was

The three-step canary: `open_app` → `type_text` → `save`, sealed text
*"Aroma Computer Operator canary. Round 1."*, saving `canary-1.txt` into
`C:\Aroma\ComputerOperator-Test`. Order hash `ea4c71a4ff7cae2318cb5c3f94ed79fb9a478013e9463e63cf900ca514c123c9`.

It was approved more than once during Phase 3b. **It never ran to completion.** The furthest any
attempt reached was `open_app`; step 3 was never attempted against a real dialog.

## Why it is superseded rather than fixed

Four rounds of measurement in the AromaOperator session established that the Save As dialog's
Save control cannot be reached by the automation this project is allowed to use:

- the dialog is a classic Win32 `#32770`;
- the Save element is identifiable — `AutomationId='1'`, native `Class='Button'`, a real HWND —
  but the managed UIA client exposes **no InvokePattern** on it;
- `LegacyIAccessible`, the other route to a default action, is **not available**.

Every remaining way to press it is something this project has ruled out: keyboard synthesis,
focus inference, or bypassing the UI and writing the file directly. So `save` is not a step that
can be honestly included in an order right now, and an order that contains a step which cannot
execute is an order that will fail after Notepad is already open, with an approval spent.

## What replaces it

`canary-work-order-2step.draft.json` — a **new** order, not an edit of this one:

| | old | new |
|---|---|---|
| steps | open_app, type_text, save | open_app, type_text |
| maxSteps | 3 | 2 |
| allowedPath | `C:\Aroma\ComputerOperator-Test` | **absent** — there is no save to bound |
| fileName | `canary-1.txt` | **absent** |
| sealedText | *"…Round 1."* | *"Aroma Computer Operator canary. Two steps. Round 1."* |
| orderHash | `ea4c71a4…` | `7cbd4dce…` *(draft; re-derived at approval)* |
| approval | **must not be reused** | a fresh Owner approval is required |

The sealed text is deliberately **different**, so a receipt, an audit line or a screenshot can
never be ambiguous about which scope produced it.

`allowedPath` is not merely omitted — `verifySeal` now **refuses** an order that carries it
without a save step (`unexpected_field`). An optional field would have let a two-step order keep
a stale path and look scoped when it was not.

## What the new order does NOT claim

Passing it proves `open_app` and `type_text`. It proves nothing about saving. The permitted
wording is fixed:

> UI INTERACTION CANARY PASSED — OPEN_APP AND TYPE_TEXT PROVEN; SAVE CAPABILITY NOT PROVEN

Not "Computer Operator complete", not "full workflow proven", not "file output proven", not
"save path verified".

## Where the save work went

`docs/governance/BACKLOG-002-targeted-native-save-activation.md` — a separate, narrowly scoped
work item. It is not part of this canary and does not gate it.

---

# ADDENDUM 2026-08-02 — the TWO-STEP order is now superseded too

`canary-work-order-2step.draft.json` did what it was for: **UI INTERACTION CANARY PASSED —
OPEN_APP AND TYPE_TEXT PROVEN; SAVE CAPABILITY NOT PROVEN**, run at 13:27:30Z under approval
`appr_68027390…`, 51 characters read back identical, cleanup measured and clean.

It is superseded because the save capability now exists (DESIGN-001, BACKLOG-002). **Do not
modify it. Do not reuse it. Do not reuse its approval.** It stays on disk as the evidence of
what was proven without a save.

| | two-step (superseded) | three-step (live) |
|---|---|---|
| file | `canary-work-order-2step.draft.json` | `canary-work-order-3step.draft.json` |
| steps | open_app, type_text | open_app, type_text, **save** |
| maxSteps | 2 | 3 |
| allowedPath | absent | `C:\Aroma\ComputerOperator-Test` |
| fileName | — | `canary-save-1.txt` |
| sealedText | *"…Two steps. Round 1."* | *"…Three steps with save. Round 1."* |
| orderHash | `7cbd4dce…` | `b346e684…` *(draft; re-derived at approval)* |

The sealed text differs again, deliberately: a receipt, an audit line or a screenshot must never
be ambiguous about which of the three scopes produced it.

**What the three-step order does NOT prove until it has run.** Whether `BM_CLICK` activates that
button is still a hypothesis. If it does not, the correct outcome is
`activation_outcome_unknown` — and the screen says so in those words, tells the Owner what state
the machine is in, and does not retry.
