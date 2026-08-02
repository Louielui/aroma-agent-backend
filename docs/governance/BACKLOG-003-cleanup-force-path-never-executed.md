# BACKLOG-003 — the cleanup force path has never executed, and two measurements disagree

**Status:** open, recorded 2026-08-02. **Not fixed, not investigated.** Blocks nothing.

## The discrepancy

Two measurements of the same thing say different things.

**Measurement A — Operator-MeasureNotepadUia.ps1, earlier on 2026-08-02.** It typed a probe
string, making the document dirty, then called `CloseMainWindow()`. The process did **not** exit:
a save-confirmation dialog appeared. That observation is why `Close-Everything` grew a
`Stop-Process` fallback, and why the canary's `cleanup` op was rewritten to re-measure instead of
reporting `closed: true` without looking.

**Measurement B — the two-step canary, 13:27:30Z.** Same shape: `type_text` had just written 51
characters, so the document was dirty. `CloseMainWindow()` was called and the audit records:

```
processExited         : true
notepadWindowsAfter   : 0
notepadProcessesAfter : 0
forced                : false
method                : "CloseMainWindow"
```

No confirmation dialog, no force needed.

## Why this matters more than it looks

**The `Stop-Process` fallback has never actually run.** It is the guarantee that a dirty Notepad
cannot be left on screen, and every line of evidence for it is from a path that was not taken.
Untested fallbacks are this project's most expensive recurring defect — the integrity-level
fallback that was dead code for three rounds, the "reassurance" that measured nothing, the
cleanup that only ran on failure.

**And one of the two measurements is describing something that was not understood.** Candidates,
none of them established:

- the probe used `ValuePattern.SetValue`, the canary uses the same — so it is probably not
  *how* the text got there;
- the tool cancelled a Save As dialog shortly before closing, and the canary never opened one:
  the dirty flag may behave differently after a dialog interaction;
- WinUI Notepad may auto-save session state and suppress the prompt in some conditions
  (Notepad has a "continue where you left off" behaviour that would explain it exactly);
- the two ran in different sessions (8 and 17) with possibly different Notepad settings.

The last is the cheapest to check and would make the difference a *setting*, not a race.

## What must NOT be concluded

That the force path is unnecessary because measurement B did not need it. B is one observation of
a behaviour that A showed can go the other way. Removing the fallback on that basis would be
deleting the safety net because the last person did not fall.

## When picked up

Determine which behaviour is the machine's, by measurement rather than by argument, and make the
force path exercisable — a test that drives the cleanup op against a process that refuses to
close, so the fallback is proven to work before it is needed.

---

# CLOSED 2026-08-02 — both items, separately

## 1. "the two measurements contradicted each other" — ROOT CAUSE CONFIRMED, closed

They never contradicted each other. They measured **different situations**, with different code,
at different moments:

| | UIA probe (measurement A) | two-step canary (measurement B) | three-step canary (measurement C) |
|---|---|---|---|
| document dirty | yes | yes | yes |
| **Save dialog open** | **yes** (cancelled moments earlier) | **no** | **yes** (prepare failed with it open) |
| `CloseMainWindow` ended the process | **no** | **yes** | **no** |

The variable is **the dialog, not the dirty flag**. A dirty document alone closes cleanly (B). A
dirty document *with a modal dialog in the way* does not (A and C). Two observations that looked
like a contradiction were a missing third column.

The wider cause is the same one that produced the `filename_field_not_found` failure: the
measurement tool and production were **two implementations**, so "the same thing" was never the
same thing. That is now structurally impossible — `uiaLookups.ps1` is dot-sourced by both and
entered through one function. See DESIGN-001 and `sharedUiaLookups.test.js`.

## 2. "the Stop-Process fallback had never executed" — EXECUTED, closed

The three-step canary of 2026-08-02 14:54:25Z triggered it for the first time:

```
forced                : true
method                : "Stop-Process after CloseMainWindow did not exit"
processExited         : true
notepadWindowsAfter   : 0
notepadProcessesAfter : 0
cleanupOk             : true
```

The fallback ran, ended the bound process, and the machine came back to zero. The measured
cleanup figures appeared on the failure screen, where the Owner could read them.

## What is still NOT measured — read this before treating the fallback as proven

**This one execution happened under one specific condition: Notepad open, a Save As dialog open,
and a dirty document.** That is the case that needed the fallback and it worked there.

Not measured, and not to be assumed from it:

- a dirty document with **no** dialog (measurement B closed cleanly *without* the fallback, so
  the forced path has still never been exercised in that state);
- a process that ignores `Stop-Process` or takes longer than the 800 ms the cleanup waits;
- a dialog other than Save As — an overwrite prompt, or the "do you want to save" confirmation;
- more than one Notepad process, which the canary's own binding rules make a refusal earlier but
  which cleanup has never had to face.

Closing this item records that the fallback works **where it has been seen to work**. It is not a
claim that it works everywhere.
