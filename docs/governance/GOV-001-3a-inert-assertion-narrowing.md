# GOV-001 — narrowing a signed Phase 3a invariant for Phase 3b

**Governance action.** Owner GO: 2026-07-28. Recorded before the change was relied on.

Phase 3a's `phase3aInert.test.js` is a signed invariant: it proves by source inspection
that the Companion can neither observe nor act. Phase 3b adds observation, so part of that
invariant necessarily has to move. This record exists so the move is inspectable rather
than discovered later in a diff.

## Summary of what actually changed

Two assertions, in two files. **Smaller than forecast** — the plan anticipated removing
observation tokens from the Companion's banned-token scan. That turned out to be
unnecessary, because the Companion *delegates* observation to a separate module rather
than performing it, so `companion.js` still contains no observation code and the scan
still passes unchanged.

| File | Assertion | Changed |
|---|---|---|
| `phase3aInert.test.js` | banned observation tokens in `companion.js` | **no** |
| `phase3aInert.test.js` | banned action calls/APIs in `companion.js` | **no** |
| `phase3aInert.test.js` | capability register all-off | **no** |
| `phase3aInert.test.js` | approved test folder absent | **no** |
| `phase3aInert.test.js` | account not created by code | **no** |
| `phase3aInert.test.js` | kill-switch register bounded | **no** |
| `phase3aInert.test.js` | **Companion import list** | **YES** |
| `companionStaging.test.js` | **derived staging closure** | **YES** (consequence) |

## Change 1 — the Companion import list

### Before

```js
test('*** the Companion imports NOTHING that could reach a desktop or a disk ***', () => {
  const imports = [...codeOf('companion.js').matchAll(/require\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  // Only the IPC contract. No fs, no child_process, no native binding, no automation lib.
  assert.deepEqual(imports, ['./sessionBoundary'], 'the Companion imports only the contract')
  for (const banned of ['node:fs', 'fs', 'node:child_process', 'child_process', 'robotjs',
    '@nut-tree', 'nut-js', 'screenshot-desktop', 'koffi', 'ffi-napi', 'edge-js', 'node-window-manager']) {
    assert.equal(imports.includes(banned), false, 'must not import: ' + banned)
  }
})
```

### After

```js
test('*** the Companion imports NOTHING that could reach a desktop or a disk ***', () => {
  const imports = [...codeOf('companion.js').matchAll(/require\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  // NARROWED FOR PHASE 3b — GOV-001, Owner GO 2026-07-28. Was ['./sessionBoundary'].
  // The Companion now DELEGATES observation to observation.js rather than performing it,
  // which is why this is the only assertion in this file that had to move: companion.js
  // itself still contains no observation code, so the banned-token scan above and the
  // capability register assertion below are both unchanged and still enforced.
  // Still a closed list, still no fs, no child_process, no native binding, no automation lib.
  assert.deepEqual(imports, ['./sessionBoundary', './observation'], 'the Companion imports only the contract and the observation boundary')
  for (const banned of ['node:fs', 'fs', 'node:child_process', 'child_process', 'robotjs',
    '@nut-tree', 'nut-js', 'screenshot-desktop', 'koffi', 'ffi-napi', 'edge-js', 'node-window-manager']) {
    assert.equal(imports.includes(banned), false, 'must not import: ' + banned)
  }
})
```

### Rationale

The assertion is still an exact closed list, not a relaxation to "contains" or a removal.
One named module was added, and that module has its own guard file
(`observationBoundary.test.js`) asserting it cannot act and imports nothing at all.

The alternative — putting observation inside the Companion — would have required deleting
the observation half of the banned-token scan, weakening a source-level proof into a
narrative. Delegation keeps the proof mechanical.

## Change 2 — the derived staging closure

`companionStaging.test.js` asserts the require-graph closure that gets staged to the
Companion's directory. `observation.js` is now a real dependency, so the derived list
changed from four names to five. This is not a relaxation: the list is DERIVED, and its
changing is the correct signal that the staged set changed.

**Operational consequence, and it is not cosmetic:** the staging directory currently
deployed on disk does **not** contain `observation.js`. The staged Companion will fail to
load until it is re-staged. This must happen before any Stage 3 measurement, and it is
called out in the Stage 3 runbook rather than left to be discovered at run time.

## Action assertions — line by line, not weakened

Every assertion below is byte-identical to its Phase 3a form and still passing.

| Phase 3a assertion | Status |
|---|---|
| Companion must not call `mouseMove`, `mouseClick`, `keyTap`, `sendKeys`, `SendKeys`, `SendInput`, `SetCursorPos` | unchanged, enforced |
| Companion must not call `spawn`, `spawnSync`, `exec`, `execSync`, `execFile`, `fork` | unchanged, enforced |
| Companion must not call `writeFile`, `writeFileSync`, `appendFile`, `unlink`, `mkdir`, `rename`, `copyFile` | unchanged, enforced |
| Companion must not reference `mouse_event`, `keybd_event`, `ShellExecute`, `CreateProcess`, `child_process` | unchanged, enforced |
| Companion must not reference `screenshot`, `captureScreen`, `BitBlt`, `PrintWindow`, `UIAutomation`, `IUIAutomation`, `AccessibleObjectFromWindow`, `EnumWindows`, `GetForegroundWindow`, `GetWindowText`, `desktopCapturer` | unchanged, enforced |
| Companion must not import `fs`, `child_process`, `robotjs`, `@nut-tree`, `nut-js`, `screenshot-desktop`, `koffi`, `ffi-napi`, `edge-js`, `node-window-manager` | unchanged, enforced |
| No "best effort" / partial-compliance path; single named refusal reason | unchanged, enforced |
| Capability register: `list_windows`, `read_ui_tree`, `capture_own_screen` all `false` | unchanged, enforced |
| `C:\Aroma\ComputerOperator-Test` must not exist | unchanged, enforced |
| No module in `src/computer` can create an account | unchanged, enforced |
| Kill-switch register claims bounded to what was demonstrated | unchanged, enforced |

**Not one action assertion was removed, softened, or scoped down.** The Companion went
from "can do nothing" to "can delegate a look, and still can do nothing."

## Assertions added in exchange

`observationBoundary.test.js` and `lock1NoModelExposure.test.js` add, for the new module:

- cannot synthesise input, touch disk, or start a process — same call-shaped scan as the Companion's
- the observation action set is closed to exactly three, and 17 named input actions can never join it
- stage 1 capabilities all off, and **a caller cannot widen them from outside**
- anything outside the closed set is refused as out-of-scope rather than attempted
- `observation.js` imports **nothing at all**
- result fields are a declared allowlist with no field for pixels or UI text to travel in
- Lock 1a: transitive require-graph — no computer module reaches a model surface
- Lock 1b: no computer module names a prompt-assembly or usage symbol
- Lock 1c: a live spy on the real seams is never called during observation, **and is proven
  to fire when something is passed to it**, so the silence is evidence rather than a dead spy

Net: one assertion moved, eleven preserved, thirteen added.
