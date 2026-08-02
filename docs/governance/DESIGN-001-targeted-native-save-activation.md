# DESIGN-001 — Targeted Native Save Activation v0.1

**Verdict:** **DESIGN ACCEPTABLE — ARBITRARY HWND AND MESSAGE ARE STRUCTURALLY UNREACHABLE FROM
UNTRUSTED INPUT.**

**Status:** design adjudication only, 2026-08-02. No code written, no package changed, no runtime
measurement taken. Implementation requires a separate Owner GO.

---

## 0. Why the verdict is yes, in one paragraph

The structure this design needs is **not new**. This system already had to solve exactly this
problem one level up: the window binding (`processId`, `windowHandle`, `uiaRuntimeId`) is a real
OS handle that must reach a native call, must never be supplied by a caller, and must never be
approvable. The answer built and tested in July–August is that the binding is **produced inside
the Companion at runtime, refused if it appears in an order, and absent from the request schema
by both an allowlist and a denylist**. The Save button is the same shape one level deeper:
dialog → button instead of process → window. What follows is that pattern applied again, plus
one control the Owner's checklist does not contain and which I think matters more than any other
item on it (§5.1).

---

## 1. Threat model

### 1.1 Untrusted — may be manipulated, may be adversarial

| Source | Why untrusted |
|---|---|
| LLM output | non-deterministic, injectable |
| Work Order content | authored upstream; the Owner approves it, but he approves a *description* |
| orchestrator | code outside the attested boundary |
| IPC / execute request | crosses a process boundary and a session boundary |
| action parameters | whatever an order carries |
| external callers | anything holding a reference to a module |

### 1.2 Trusted — the boundary this design relies on

| Component | Why it is inside |
|---|---|
| the attested Companion process | identity attested before any step: SID, session, desktop, integrity, elevation, group SIDs, collector hash |
| the internal binding resolver | runs inside that process, from values it produced itself |
| the packaged PowerShell helper | its **bytes are in the execution package hash the Owner approves**, and it is invoked over a private transport with a closed op set |

### 1.3 What this design promises — and what it refuses to promise

**Promised.** An untrusted caller cannot name a window, cannot name a message, and cannot cause
any message to be sent to anything it chooses. Not "is prevented from" — *cannot express it*:
there is no field, parameter, or schema slot in which such a value could be written.

**NOT promised.** That a Companion process already running attacker-controlled code can be
stopped from calling `user32!SendMessage` directly. Nothing short of a different OS boundary
achieves that, and a design claiming it would be lying. The containment for that case is
elsewhere and unchanged: a non-admin account, medium integrity, one writable folder, no delete
right on the audit directory, and a kill switch.

---

## 2. Public API — the interface accepts no raw target

The forbidden names — `hwnd`, `parentHwnd`, `processId`-as-selector, `message`, `wParam`,
`lParam`, `AutomationId`, `ClassName` — appear in **none** of: the Work Order, the request schema,
any IPC payload, any exported function signature, any CLI argument, any LLM-controllable field.

This is already enforced by machinery that exists today:

- **`ACTION_FIELDS`** in `sealedOrderGate.js` is a frozen per-action allowlist. `save` is
  `['action', 'n', 'fileName']`. An order step carrying anything else is refused
  `unexpected_field` **before** the hash is even checked.
- **`REQUEST_FIELDS`** in `executeRequestSchema.js` is a closed allowlist of ten metadata fields.
- **`FORBIDDEN_FIELDS`** is a *separate* denylist covering `action`, `path`, `command`, `args`,
  `payload`, `script`… — deliberately redundant, "so the day somebody widens the first one they
  will have to argue with the second". `hwnd`, `message`, `wParam`, `lParam` join it.
- **`$REQUIRED_FIELDS`** in `uiaCanary.ps1` is a closed op table; an unknown op refuses
  `unknown_op` at validation *and* again at dispatch.

The capability the caller may express is exactly one verb with no target:

```
save   (order step: { action, n, fileName })
```

`fileName` is already constrained by `fileNameProblem()`: a bare name, `[A-Za-z0-9._-]` only, no
separators, no traversal, no drive letter. It selects a *name inside one fixed folder*; it cannot
select a window.

---

## 3. The target is derived, never received

```
attested AromaOperator session (SID + session id + desktop + integrity, audited)
  └─ the Notepad process THIS run launched  (set difference: before-set proven empty)
       └─ the bound main window             (pid + native handle + UIA RuntimeId, re-verified)
            └─ the Save dialog owned by that window
                 └─ the unique control matching AutomationId '1' AND native class 'Button'
```

Every arrow is a step the Companion takes from a value it already holds. No arrow starts from
caller input.

### 3.1 Where the design departs from the Owner's sketch, and why it is stronger

The Owner proposed an opaque one-shot capability object, or a `bindingId` registry, holding the
real HWND.

**Neither is needed, and both are weaker.** A capability that crosses a boundary is a thing that
can be forged, replayed, leaked or logged. The stronger design is that **the HWND is never
computed outside the helper at all**:

- the Node side passes the binding it already has (as it does today for `type_text`);
- the helper derives dialog → button internally, uses it, and discards it;
- no new identifier is created, serialised, stored, or returned.

There is nothing to forge because nothing crosses. The "capability" is the invocation itself —
one op call, bounded by the transport, inside one trusted boundary.

**A raw HWND is therefore never returned to JavaScript, never written to an audit record, never
placed in a result object.** (The *window* handle already in the binding stays as it is; that is
the existing, approved design and it is a window we opened.)

---

## 4. The message is a constant, structurally

`BM_CLICK` (0x00F5) is a literal inside one function inside `uiaCanary.ps1`. It is not a
parameter, not read from config, not read from the order, not passed over IPC.

**No FFI dependency is introduced.** Measured today: the repo has 7 dependencies and **none** is
`ffi-napi`, `koffi`, `node-gyp` or any native bridge. That is load-bearing — a generic FFI
library in the Node process *is* an arbitrary-syscall capability by construction, and every guard
above it would be decoration. The design keeps JavaScript with **no ability to call Win32 at
all**.

The primitive lives where P/Invoke already lives and is already contained: packaged PowerShell.
`collect-identity.ps1`, `measurementContext.ps1` and `observer.ps1` already `DllImport` from
`user32.dll` — all read-only (`GetProcessWindowStation`, `GetThreadDesktop`, DPI awareness). The
containment is that their **bytes are pinned by the package hash the Owner approves**, and their
entry points are a closed op set.

The exported surface is one verb:

```
activateVerifiedSaveButton(bind)      # helper op: activate_bound_save, requires ['bind'] only
```

No `sendMessage(hwnd, msg, w, l)` is exported, defined, or reachable.

---

## 5. Re-verification immediately before the send

All of it happens **inside one helper invocation**, in the microseconds before the call, with no
process boundary in between (§6).

| # | Check | Refusal code |
|---|---|---|
| 1 | process alive, same pid | `process_gone` |
| 2 | same session as attestation | `session_changed` |
| 3 | bound main window still resolves by handle | `window_changed` |
| 4 | Save dialog present and owned by that window | `save_dialog_not_found` |
| 5 | dialog's ProcessId == bound pid | `dialog_process_mismatch` |
| 6 | dialog is the expected modal class (`#32770`) | `dialog_class_unexpected` |
| 7 | exactly ONE control matching AutomationId `'1'` + class `Button` | `save_control_not_unique` |
| 8 | that control's AutomationId is exactly `'1'` | `save_control_id_mismatch` |
| 9 | its native class is exactly `Button` | `save_control_class_mismatch` |
| 10 | enabled | `save_control_disabled` |
| 11 | visible / not offscreen | `save_control_offscreen` |
| 12 | its HWND is non-zero and is a child of the dialog | `save_control_not_in_dialog` |
| 13 | **the filename field still holds the exact expected absolute path** | `filename_field_altered` |
| 14 | target path still does not exist | `refuse_overwrite` |
| 15 | approvalId matches the admitted run | `approval_mismatch` |
| 16 | step nonce unconsumed and matching | `nonce_mismatch` |
| 17 | capability window not expired (≤ 5 s since verification began) | `activation_window_expired` |
| 18 | not already activated in this run | `already_activated` |

**Any failure refuses. No re-search, no nearest-match, no fallback to another HWND, no retry.**

### 5.1 Check 13 is the one the checklist does not have, and it is the most important

`BM_CLICK` presses Save. **What gets written is whatever the dialog currently holds, not what we
intended.** Every other check establishes *which button*; none establishes *what pressing it
does*. If the filename field were changed between our `SetValue` and the click — by a focus
event, an autocomplete, a shell extension, or anything else — a verified click on a verified
button would write a verified file to the wrong place, and every check above it would have
passed.

So the filename field's value is re-read immediately before the send and must equal the exact
expected absolute path, character for character. Without this the containment argument for
"writes only inside the allowed folder" does not survive the move from `Invoke()` to a raw
message.

---

## 6. HWND reuse and TOCTOU

**The risk, stated plainly.** Windows recycles window handles. Between check 12 and the send, the
dialog could be destroyed and its handle reissued to an unrelated window. `BM_CLICK` would then
be delivered to a stranger.

**This cannot be eliminated.** Any design claiming otherwise is wrong: there is no atomic
"verify-and-post" in the Win32 API, and no lock that prevents another process's window from
being created.

**What the design does about it:**

1. **One trusted execution boundary.** Verification and send occur in the same PowerShell
   function, in one op invocation. There is no round trip to Node, no transport hop, no JSON
   serialisation between the last check and the call. The window is microseconds, not the ~100 ms
   a cross-process design would have.
2. **The last checks are the cheapest ones.** Ordering puts the expensive tree walks first and
   the identity comparisons (handle, class, enabled, filename value) immediately before the send.
3. **The message is inert to a stranger.** `BM_CLICK` to an arbitrary window is not a generic
   command; on a non-button it is typically ignored. This *reduces* the consequence; it does not
   remove it, and it is not offered as the primary control.
4. **Post-send re-confirmation** (§7) re-establishes the dialog/process relationship rather than
   assuming it held.

**Residual risk, accepted or refused by the Owner, not by me:** a handle recycled inside a
microsecond window could receive one `BM_CLICK`. Probability is very low; consequence is bounded
by the operator account's own limits (non-admin, medium integrity, one writable folder).

---

## 7. "Attempted" and "verified" are different records

The audit must never infer a save from a call returning.

**`activation_attempted`** — every condition in §5 held and the `BM_CLICK` call completed.
This records *that a button was pressed*, nothing more.

**`save_verified`** — all of:

- the Save dialog is gone;
- a new file exists at the exact expected absolute path;
- no pre-existing file was overwritten (checked before, re-checked after);
- the file's byte length and SHA-256 match the sealed text as written;
- the Notepad document state is consistent with a completed save.

**If the dialog did not close:**

- look for identified validation/error UI within the dialog;
- **only with positive evidence** may `save_rejected` be recorded;
- otherwise record **`activation_outcome_unknown`** and **stop**.

**Forbidden:** automatic retry of `BM_CLICK`; inferring success or failure from elapsed time;
treating "the call returned" as evidence of anything.

`activation_outcome_unknown` is a terminal state for the run. Recovery is a new approval — the
same rule the step nonce already enforces, and for the same reason: an outcome nobody can
evidence must not be retried by a machine.

---

## 8. Structural guards — each must go red on the degradation it names

| # | Degradation | Guard |
|---|---|---|
| 1 | a generic `SendMessage` is exported | source scan: `SendMessage`/`PostMessage` may appear in **exactly one** named file, inside one named function; anywhere else fails |
| 2 | `hwnd`/`message`/`wParam`/`lParam` added to a schema | assert each is absent from `ACTION_FIELDS`, `REQUEST_FIELDS`, `$REQUIRED_FIELDS`, `$BIND_FIELDS`; and present in `FORBIDDEN_FIELDS` |
| 3 | IPC can carry an HWND | round-trip a request containing `hwnd` → refused `forbidden_field`; positive control proves the harness would notice |
| 4 | the message becomes a parameter | assert the helper function's parameter list contains no message argument, and `0x00F5` appears as a literal |
| 5 | the resolver accepts an arbitrary window | inject a window not descended from the bound one → refused, no send |
| 6 | a capability is forged as a plain object | no capability crosses a boundary at all; assert the helper's op accepts only `bind` and derives the rest |
| 7 | reuse | second `activate_bound_save` in one run → `already_activated`, zero sends |
| 8 | cross-order use | binding from run A + approval from run B → refused, zero sends |
| 9 | Save control not unique | two matching controls → `save_control_not_unique`, zero sends |
| 10 | dialog/process relationship changed | mismatched dialog pid → `dialog_process_mismatch`, zero sends |
| 11 | success reported without postcondition | force "dialog closed, file absent" → must record `activation_outcome_unknown`, never `save_verified` |
| 12 | filename field altered | change the field between set and send → `filename_field_altered`, zero sends |
| 13 | no FFI creeps in | assert no dependency matches `ffi|koffi|node-gyp|ref-` |

Every negative test must assert **zero sends**, not merely a refusal — a refusal that sent the
message first is not a refusal. That requires the send to be behind an injectable seam in tests
while remaining a literal constant in production.

---

## 9. Capability lifecycle

There is no serialisable capability object. The lifecycle is the invocation:

| Phase | |
|---|---|
| **Created** | when `activate_bound_save` is entered, from the existing binding + approvalId + step nonce |
| **Scope** | one process, one function, one op invocation |
| **Bound to** | approvalId, step nonce, bound pid, bound window handle, the located dialog |
| **Lifetime** | ≤ 5 seconds from first check to send; expiry refuses `activation_window_expired` |
| **Uses** | exactly one; a second attempt in the same run refuses `already_activated` |
| **Destroyed** | when the function returns; the HWND is a local variable and is never returned, stored, logged or serialised |
| **Forgeable** | no — a caller cannot construct one because none crosses a boundary |

---

## 10. Residual risks, stated

1. **HWND recycling in the microsecond window** (§6) — reduced, not eliminated.
2. **A fully compromised Companion process** can call the OS directly; out of scope by the
   Owner's own instruction, contained only by the account's limits.
3. **`BM_CLICK` may not activate this button.** Unmeasured. The control has no InvokePattern and
   no LegacyIAccessible; whether it responds to a posted click is a hypothesis. If it does not,
   the outcome is `activation_outcome_unknown` — which is a correct, honest failure, not a wrong
   action.
4. **The dialog structure is measured on one machine, once.** A Windows update can change it.
   Every check is a refusal, so a change stops the run rather than misdirecting it.
5. **The force path in cleanup is still unexecuted** (BACKLOG-003) and is adjacent to this work.

---

## 11. What must NOT happen when this is implemented

- No FFI dependency added to `package.json`.
- No widening of `NEVER_ACTIONS`.
- No reuse of the two-step canary's approval; a save capability needs its own order, its own hash
  and its own Owner approval.
- No claim that the two-step canary proved anything about saving.
- No implementation before a separate Owner GO. **This document is a decision, not a start.**
