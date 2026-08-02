# BACKLOG-002 — Targeted Native Save Activation v0.1

**Status:** open, not started, **not scheduled**. Opened 2026-08-02 by Owner decision when the
canary shrank to two steps.
**It does not gate the two-step canary.** That canary is complete without it.

## What is already known, from four measured rounds

The Save control in the Save As dialog **is precisely identifiable**:

| | |
|---|---|
| dialog class | `#32770` — the classic Win32 dialog |
| AutomationId | `'1'` (IDOK) |
| native class | `Button` |
| HWND | present, a real window handle |
| managed UIA | **no InvokePattern** |
| LegacyIAccessible | **not available** |

So the problem is not identification. It is that every route this project permits for *pressing*
it is closed: UIA offers no invoke, the legacy bridge is absent, and keyboard synthesis, focus
inference and writing the file directly are all ruled out by standing principle.

## The one candidate to evaluate next: `BM_CLICK`

Sending the `BM_CLICK` window message to the button's own HWND. It is not a keystroke, it does
not depend on focus, and it does not bypass the UI — it asks that specific button to do what a
click does.

**It is also a general-purpose weapon if built carelessly.** `SendMessage` to an arbitrary HWND
can drive anything on the desktop. So the evaluation is not "does BM_CLICK work" — it is
"can a capability this narrow be built without becoming a general one".

## Constraints, all of which must hold before a single message is sent

1. the target HWND belongs to the **already-bound** Save dialog — proven, not assumed;
2. it matches **AutomationId `'1'` AND native class `Button`**, both;
3. it is **unique** within that dialog — more than one candidate is a refusal, never a choice;
4. it is **enabled** and **visible**;
5. **exactly one** message is sent, once;
6. it can never become an arbitrary `SendMessage` capability — no caller-supplied HWND, no
   caller-supplied message id, no path where either is a parameter;
7. the **postcondition is verified**: the dialog closed AND the expected file now exists;
8. if any relationship above cannot be proven, it **refuses** and sends nothing.

Constraint 6 is the one that decides whether this is buildable. A function that takes an HWND
and a message is a remote-control primitive with a narrow caller, and callers change. If the
design cannot make the target structurally underivable from input, the answer is no.

## What must NOT happen when this is picked up

- No widening of `NEVER_ACTIONS` to admit generic window messaging.
- No reuse of the two-step canary's approval — a save capability needs its own order and its own
  Owner approval.
- No claim that the two-step canary proved anything about saving. It did not, and the permitted
  wording says so.
