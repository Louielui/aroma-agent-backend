---
Version: 1.0
Status: DRAFT (awaiting Owner approval)
Classification: Governance Data — Owner-only
Approved-by: (pending Louie)
Last-Updated: 2026-07-12
---

# AISL-003 — Tool Allowlist

Tools are the **executable capabilities** an actor's session physically contains.
Authorization at this layer is **structural**: a tool absent from a session
**does not exist** for that actor — it is never listed, never callable, never
"refused." This is the core of AISL enforcement (AISL-v1.0 §2).

## 1. Tool Tiers

| Tier | Name | Plane | Examples (illustrative) |
|---|---|---|---|
| **T1** | Core Governance | **Governance** | modify prompt/memory/AISL, edit permission model, assign roles, issue Governance GO, manage secrets, alter policy thresholds |
| **T2** | System Management | **Governance** | manage connector/MCP/desktop-agent/worker/workflow-engine, source/repo/deploy, security config |
| **T3** | Business Operations | **Business** | create/approve business proposals, purchasing, inventory ops, recipe/menu/supplier ops, scheduling, HR/finance business actions, Business GO |
| **T4** | Read-Only | **Business** | health, list/read proposals, return-ready, result, reports, business audit read |

- **T1 + T2 = Governance Plane tools.**
- **T3 + T4 = Business Plane tools.**

## 2. Per-Role Tool Visibility

| Tier | Owner | Executive Director | Manager | Staff | External |
|---|---|---|---|---|---|
| **T1 Core Governance** | ✅ present | ❌ absent | ❌ absent | ❌ absent | ❌ absent |
| **T2 System Management** | ✅ present | ❌ absent | ❌ absent | ❌ absent | ❌ absent |
| **T3 Business Operations** | ✅ present | ✅ present | 🔷 scoped | 🔷 scoped | ❌ absent |
| **T4 Read-Only** | ✅ present | ✅ present | 👁 present | 👁 present | 👁 scoped |

## 3. Executive Director session — the structural guarantee

> An **Executive Director session contains the full Business-Plane tool set
> (T3 + T4) and ZERO Governance-Plane tools (T1 + T2).** The Governance tools are
> **structurally absent** — not present-and-refused.

Consequences:

- There is **no tool in the session** to modify a prompt, edit AISL, touch the
  permission model, manage a connector/worker, reach secrets, or issue a
  Governance GO. A request to do so cannot be fulfilled because **the capability
  is not there to invoke** — there is no refusal message to bypass and no prompt
  to jailbreak.
- This holds even under prompt injection or a compromised Executive Director
  account (AISL-006): the missing tool was never present to abuse.

## 4. Read-only tools are their own tier (T4)

T4 (health, proposals list/read, return-ready, result, reports, audit-read) is
deliberately separated from T3 write operations so that a read-only surface (e.g.
the Phase-2 MCP connector, AISL-008) can expose **T4 only**, with **no T3/T1/T2
path present at all**. A read-only session is read-only by construction.

## 5. Adding or moving a tool is a Governance action

Introducing a new tool, changing its tier, or changing which roles it is present
for is a **Governance-Plane change** — Owner-only, via the Governance GO
(AISL-005). Tiering is not editable from the Business Plane.

## Changelog

- **v1.0 — initial draft — 2026-07-12.** Four tool tiers (T1–T4) mapped to planes;
  Executive Director holds all Business-plane tools, zero Governance-plane tools,
  structurally absent.
