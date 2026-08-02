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
