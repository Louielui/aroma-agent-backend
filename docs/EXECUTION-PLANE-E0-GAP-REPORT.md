# Aroma Execution Plane — E0 Gap Report

**Status:** E0-1 consolidation baseline  
**Date:** 2026-08-10  
**Baseline:** `main@ddf4e58dc4b5c503dbd433c9485d8504ebc58566`  
**Decision record:** GitHub issue #36

## Executive conclusion

Aroma does **not** need a new browser engine, a new generic capability registry, or a new generic dispatcher before the first execution canary.

The repository already contains three distinct execution foundations:

1. **Capability / agent lane** — typed capabilities, policy-first dispatch, approvals and worker adapters.
2. **Browser / errand lane** — real Playwright browser actions with origin, payment, request and composition fences; at least one read-only scheduled errand is already wired into the backend runtime.
3. **Computer Operator lane** — sealed work-order, dry-run, audit, kill-switch, IPC and contained companion foundations; the companion is deliberately zero-capability today.

The missing layer is primarily **a governed entrance from Aroma conversation/orchestration into the existing browser and computer lanes**, plus the first narrow desktop observation/action capabilities. Do not solve that by creating parallel infrastructure.

---

# 1. Capability / agent lane

## Already real

`src/capability/registry.js`

- exact `(capability, version)` contracts
- lifecycle: draft / active / deprecated / retired
- risk tiers
- default approval requirement
- no implicit latest version

`src/capability/policy.js`

- evaluates before dispatch
- verdicts: allow / require_approval / deny
- sensitive-domain deny
- production Deploy/Rollback approval
- high-risk fail-safe approval

`src/capability/dispatcher.js`

- policy first
- no adapter call while denied or waiting for approval
- agent selection and health ranking
- adapter validation
- fallback
- event/timeline evidence

`src/app.js`

- the capability dispatcher is wired for the existing software-agent Develop/Apply lane
- real Claude Code adapter is constructed lazily
- execution authorization remains controlled by the existing flag matrix

## Important limit

The seeded capability registry is currently generic software-work vocabulary (`Think`, `Plan`, `Research`, `Develop`, `Apply`, `Deploy`, etc.). It does **not** currently define low-level browser or Windows UI actions.

Only the seeded `claude-code` agent advertises real capability contracts in the current agent registry.

## E0 ruling

Do **not** create another registry or dispatcher.

Also do **not** assume every execution subsystem must be mechanically moved into `src/capability/dispatcher` before it can be used. Browser and Computer Operator already have stronger domain-specific boundaries. E0 should adapt/route to those boundaries rather than flatten them.

---

# 2. Browser lane

## Already real

The browser verbs exist and execute real Playwright actions:

- navigation
- accessibility-tree read
- click
- type
- wait
- screenshot

`src/browser/browserSession.js` is a real session constructor. Before launching it verifies profile state and origin policy, then launches Playwright, installs the request fence, enables DOM/accessibility inspection, and returns the guarded verbs.

Its live safety layers include:

- payment stop inside click
- non-GET request fence
- government-origin block
- profile probes before launch
- read → act → read composition rule

There is direct real-world evidence in `scripts/errandLastOrder.js`, a read-only Costco Business Centre workflow using the real browser session.

## Already runtime-wired

Browser automation is not merely test/script code.

`src/errands/recallRunner.js` launches Playwright with a read-only order and uses the guarded browser primitives.

`src/app.js` wires that runner into the scheduled errand surface through:

```text
scheduledRunners.recall -> runRecallForIngredients()
```

The scheduled route is service-token guarded and has server-side knock logging and a minimum run interval. The runner has no credential profile and no permitted writes.

Therefore:

> Browser engine = REAL  
> Browser scheduled read-only runtime = REAL  
> Conversational browser entrance = MISSING

## Explicit existing design

`docs/DESIGN-CONVERSATIONAL-BROWSING.md` is ACTIVE design but says **DESIGN ONLY. No code exists.**

Its intended conversational entrance is deliberately deterministic:

- explicit URL/domain + browse verb -> may offer an errand
- site name already in reviewed site registry -> may offer an errand
- otherwise ask which site; do not let an LLM guess the origin
- the message creates an OFFER, never direct action
- target/origin is derived server-side
- public/profile-less GET-only browsing can be lower risk
- credential profile or allowed writes require a sealed approval path
- async run + waiting-bar status + STOP control

Search at the E0 baseline finds `browseRequestOffer` and `siteRegistry` only in the design document, not implementation.

## Browser gap

The first browser gap is **not Playwright**.

It is the governed bridge:

```text
Owner sentence
  -> deterministic browse entrance
  -> server-derived fenced order
  -> existing browser/errand runner
  -> async status + stop
  -> result/evidence back to Aroma
```

## Recommended first browser canary

**E0-B1 — Conversational Public Read Canary**

Scope should be deliberately narrow:

- explicit URL/domain only for the first canary; site registry may follow separately
- ephemeral/profile-less browser only
- GET-only order; no allowed writes
- one reviewed public origin
- read + navigate only at first; no typing required for the first proof
- immediate acknowledgement; execution asynchronous
- Owner STOP available for whole run
- final result returns one auditable outcome
- zero paid model call required to decide the origin or authorize the action

Example proof:

> 「香香，去 https://<reviewed-public-site> 睇下 <specific public fact>。」

Success means the sentence starts a fenced existing browser errand and returns evidence without widening browser capability.

---

# 3. Windows / Computer Operator lane

## Phase 1 — contract exists, action does not

`src/computer/computerWorkOrder.js` is a pure fail-closed work-order schema.

Current closed action enum is file-only:

- `read_file`
- `create_file`
- `copy_file`

The code explicitly records the Owner ruling that desktop actions such as `open_app`, `type_text` and `click` must **not** be added to this file-order enum. Desktop actions require their own order type because their preconditions, evidence and blast radius differ.

The allowed root remains narrowly scoped to the ComputerOperator test directory and destructive/network/security actions are forbidden.

## Phase 2 — dry-run supervisor exists

`src/computer/computerSupervisor.js`:

- validates sealed orders
- checks scope
- consumes nonces
- writes dry-run audit records
- exposes assurance as VERIFIED vs NOT VERIFIED
- has no execute method
- touches no desktop

It is deliberately structurally incapable of real action.

## Flag state

`src/computer/computerOperatorFlag.js` exists but explicitly says:

- no `src/` module calls it
- `COMPUTER_OPERATOR=on` currently has zero effect
- the coexistence rule with `WORKER_INVOCATION`, `DEVELOP_DISPATCH`, and `AGENT_BRIDGE` is still an open Owner architecture question

This must be decided before Computer Operator becomes a normal Aroma runtime lane.

## Phase 3a — real contained companion transport exists

The repository has:

- named-pipe IPC contract
- staged companion entrypoint
- separate `AromaOperator` account containment deployment tooling
- session-gate tooling
- audit/evidence support
- rollback tooling
- kill-switch bindings

Containment evidence dated 2026-07-28 records 17/17 checks holding inside the real AromaOperator interactive session.

The kill-switch bindings were separately demonstrated against live companions: service gate, companion abort, and OS/channel fallback.

## But the companion has zero capability

`src/computer/companion.js` currently declares all capabilities false:

- `list_windows: false`
- `read_ui_tree: false`
- `capture_own_screen: false`
- `move_mouse: false`
- `send_keys: false`
- `launch_app: false`
- `write_file: false`
- `read_file: false`
- `network: false`

Every `execute_step` is refused with `no_capability_enabled`.

Therefore:

> Computer containment / transport = REAL  
> Computer kill path = REAL and demonstrated  
> Computer dry-run governance = REAL  
> Computer observation = NOT IMPLEMENTED  
> Computer desktop action = NOT IMPLEMENTED  
> Computer normal Aroma runtime flag wiring = NOT IMPLEMENTED

## Windows gap

The correct next Windows step is **not** `open_app + type_text` immediately.

The next missing tranche is observation-only Phase 3b, because the Phase 2 supervisor explicitly lists machine facts it cannot verify without a companion.

## Recommended first Windows canary

**E0-W1 — Observation-Only Companion Canary**

Enable exactly one narrow observation capability first:

1. `list_windows`

Do not enable in the same tranche:

- mouse movement
- keyboard input
- app launch
- file write
- shell
- network
- screenshot unless separately approved

Success means:

```text
Aroma/Service
  -> sealed observation request
  -> contained AromaOperator Companion
  -> list top-level windows
  -> bounded, allowlisted evidence
  -> audit record
  -> stop / channel close works
```

Only after that passes should a separate Owner GO consider `read_ui_tree`, then a later **desktop order type** for a first Notepad action canary.

---

# 4. What must NOT be rebuilt

Do not build another:

- generic capability registry
- generic policy engine
- generic dispatcher
- Playwright browser engine
- browser accessibility reader
- browser click/type primitives
- Computer Operator file work-order schema
- dry-run audit system
- kill-switch semantic layer
- named-pipe transport
- companion containment deployment system

Those foundations already exist.

---

# 5. The actual missing top layer

The current repository has several execution lanes with different blast radii and therefore different domain contracts.

E0 should introduce **one Aroma-facing execution map / entrance**, not one universal low-level executor contract.

Conceptually:

```text
Owner / Conversation
        |
        v
Aroma intent / deterministic offer layer
        |
        +--> Software work -> existing Capability Dispatcher / Agent Bridge
        |
        +--> Browser errand -> existing fenced Browser + Errand lane
        |
        +--> Windows work -> existing Computer Operator sealed-order lane
```

The top layer decides **which governed lane owns the work**. It must not turn free text directly into low-level action names.

---

# 6. Recommended sequence from this baseline

1. **E0-B1 — Conversational Public Read Canary**
   - smallest path to visible user value because the browser engine and read-only runtime already exist.

2. **E0-W1 — Observation-Only Windows Companion (`list_windows`)**
   - validates real desktop observation through the already-contained companion without action risk.

3. **E0-W2 — UI-tree observation**
   - only after W1 evidence proves the channel and bounded observation surface.

4. **E0-W3 — Desktop Work Order + Notepad action canary**
   - new desktop-specific sealed order type
   - `launch_app` and/or `type_text` introduced in an independently reviewed slice
   - explicit Owner approval
   - no shell, no destructive file access, no network/payment

5. **Execution routing consolidation**
   - expose browser/computer lanes to Aroma through one owner-facing task model while preserving their domain-specific governors.

6. **W1 Wisdom later**
   - once real execution produces trustworthy experience/outcome evidence, Reflection can extract candidate lessons from actual work.

---

# E0-1 final state

**Inventory complete.**

The first build should target the missing conversational entrance, not infrastructure already present.

Recommended next Owner GO:

> **E0-B1 — Conversational Public Read Canary**

No real browser or desktop capability is authorized by this gap report itself.
