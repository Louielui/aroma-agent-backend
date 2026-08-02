# BACKLOG-002 — Targeted Notepad Save Not Proven

**Status: BACKLOGGED / NO FURTHER DIAGNOSTIC ROUNDS AUTHORIZED.**
Closed to further work 2026-08-02 by Owner decision, after an evidence-gated final attempt.

**The correct statement of where this stands, and the only one to be used:**

> The evidence accessible today is not sufficient to identify a structurally safe filename field,
> and Targeted Notepad Save is therefore **not proven**.

It must **not** be written up as *infeasible*, as *impossible*, as *Windows 11 does not support
it*, or as *BM_CLICK failed*. None of those was measured, and none follows from what was. What ran
out was accessible evidence, not viability.

`open_app` + `type_text` are unaffected and retain their standing:
**UI INTERACTION CANARY PASSED.**

---

## PROVEN

- the Save dialog can be uniquely identified and verified;
- its native ClassName is `#32770`;
- the UIA ProcessId and the native process id agree (both read, both 44612 in the final run);
- dialog ownership belongs to the bound Notepad main window — `GetWindow(h, GW_OWNER)` matched,
  the strongest of the three accepted relations;
- the native activation design stays narrow;
- untrusted input cannot express an HWND or a Windows message;
- `BM_CLICK` is confined inside the trusted helper;
- filename-alteration and folder-alteration guards are designed;
- the shared UIA lookup module and its structural guards are built.

## NOT PROVEN

- the actual UIA node of the filename field;
- the complete ancestor / descendant chain;
- the control-view vs raw-view difference;
- whether a unique candidate supports ValuePattern;
- the exact reason the current selector misses the candidate;
- Save activation, and the `save_verified` postcondition.

## OBSERVED

The production resolver searches with:

| | |
|---|---|
| root | the **verified** Save dialog |
| scope | `TreeScope::Descendants` |
| view | control view (`FindAll`) |
| condition | `AutomationId = 'System.ItemNameDisplay'` **AND** `ControlType = Edit` |

Both conditions must hold **on the same element**.

The existing audit preserves only `filenameCandidates: 0`. It does not serialise the dialog
subtree, any patterns, or any candidate node. It therefore cannot distinguish between:

1. the AutomationId sitting on a **ComboBox**, whose Edit child carries a different id;
2. the element existing only in the **raw view**;
3. this Windows build using a **different AutomationId**.

Three structurally different causes, one identical measurement. Choosing between them without
evidence would be the sixth repetition of the defect the shared lookup module was built to end.

## Deferred evidence note

A possibly relevant existing measurement transcript is at
`C:\Aroma\ComputerOperator-Evidence`. The executing session has no read permission for it.

**This round did not change ACLs, did not copy it, did not switch accounts, and did not pursue
it.** Nothing here is a request to do so.

Any future access requires a **new, explicit Owner decision**, opening a separate **read-only
evidence retrieval** task. This backlog entry does **not** authorise that work and must never be
read as automatically restarting Save development.

---

## Original entry — Targeted Native Save Activation v0.1

Opened 2026-08-02 by Owner decision when the canary shrank to two steps. Retained below as the
design record; superseded as to status by the ruling above.
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
