# BACKLOG-001 — intermittent EPERM test failure on Windows

**Status:** characterised, not fixed. Deferred by Owner, 2026-07-28.
**Not** a defect in the code under test.

## Why this record exists

This is the "there's a test that fails intermittently" item that had been carried as a
sentence. A sentence is not actionable — it cannot be searched for, recognised on sight, or
told apart from a real regression. It now has a signature.

## Signature

```
Error: EPERM: operation not permitted, rename
  'C:\Users\louis\AppData\Local\Temp\<prefix>-XXXXXX\<name>.json.tmp'
  ->
  'C:\Users\louis\AppData\Local\Temp\<prefix>-XXXXXX\<name>.json'
  errno: -4048, code: 'EPERM', syscall: 'rename'
```

Observed instances, both in the same shape:

| Test | Temp prefix | File |
|---|---|---|
| `src/coo/proposal.persistence.test.js` — cancel → restart → status persists | `aroma-prop-store-` | `aroma-proposals.json` |
| `src/coo/*` recovery path | `aroma-recover-` | `aroma-runs.json` |

## What it is

An atomic-write pattern — write `.tmp`, then `rename` over the target — colliding with
something on Windows holding a transient handle to the temp directory. Antivirus real-time
scanning and the search indexer both do this. `rename` is not retried, so a momentary lock
surfaces as a hard failure.

Confirmed as environmental, not a code defect:

- the affected file passes **10/10 in isolation**, immediately after failing in a full run
- it only appears under a full-suite run, where many temp directories are created at once
- the failure is in `renameSync` inside the persistence helper, never in an assertion
- it moves between test files across runs rather than staying with one

## How to tell it apart from a real regression

- `code: 'EPERM'` and `syscall: 'rename'` on a path under the system temp directory
- the stack bottoms out in `renameSync` in a persistence module, not in an assertion
- re-running that single test file passes

If any of those do not hold, it is **not** this — treat it as a real failure.

## Fix when it is picked up

Retry the `rename` with a short backoff — three attempts, ~50 ms apart — and only then
throw. That is the standard mitigation for this pattern on Windows and it does not weaken
the atomicity guarantee: the rename either happens or it does not, and retrying a transient
`EPERM` does not change that.

Do **not** "fix" it by switching to a non-atomic write. The atomic rename is what stops a
half-written store being read back, which is a real correctness property and worth more
than an occasional flake.

## Scope note

Every suite figure reported during Phase 3b was taken from a run where this did not fire,
or was re-run to confirm `0 fail`. Where it fired, it was named as a flake and the re-run
result was given.
