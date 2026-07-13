---
Version: 1.0
Status: APPROVED
Classification: Governance Data — Owner-only
Approved-by: Louie
Approval date: 2026-07-13
Last-Updated: 2026-07-12
---

# AISL-001 — Role Hierarchy

Five roles, ordered by authority. Higher roles do **not** automatically inherit
Governance-Plane power — authority is scoped by **Plane** (see AISL-v1.0 §4), not
by seniority alone.

```
  Owner (Louie)
     │   both planes · both GOs · sole Governance authority
     ▼
  Executive Director
     │   full Business Plane (incl. Business GO) · ZERO Governance Plane
     ▼
  Manager
     │   scoped Business operations · no GO
     ▼
  Staff
     │   task-level Business operations · no GO
     ▼
  External
         read-restricted / task-specific · no GO
```

## 1. Owner (Louie)

- **The only actor present in BOTH planes.**
- Holds **both GOs**: the **Business GO** and the **Governance GO (Owner GO)**.
- Sole authority to modify Aroma itself: prompts, memory, AISL, policy,
  connectors, MCP apps, desktop agent, workers, workflow engine, security,
  secrets (status only — never the value), source, repository, architecture,
  development plan, and the permission model.
- Sole authority to set/alter **Policy thresholds** (dual-approval limits,
  spending limits, maintenance mode, etc.) — changing a threshold is a
  **Governance action**, not a Business one.
- Can appoint/remove all other roles. No other role can assign the Owner role or
  grant Governance authority.

## 2. Executive Director

- **Full Business Plane operational authority — including the Business GO.** The
  Executive Director can run the entire restaurant business autonomously:
  approve Business proposals, direct purchasing, manage inventory, recipes,
  suppliers, menu, scheduling, branches, central kitchen, customers, finance and
  HR operations, and read business audit.
- **ZERO Governance Plane authority.** The Executive Director **cannot** modify
  Aroma, its prompts, memory, AISL, policy, connectors, MCP, desktop agent,
  workers, workflow engine, security, secrets, source, repo, architecture, dev
  plan, or the permission model. These capabilities are **structurally absent**
  from an Executive Director session (see AISL-003) — not refused on request.
- **High-Risk Business** operations remain the Executive Director's to approve,
  but pass through **Policy-Layer gating** (thresholds / dual-approval) — a gate,
  not a prohibition (see AISL-005). **Absolute redlines** (AISL-005 §5) override
  even the Executive Director.
- Cannot issue the Governance GO. Cannot elevate self or others into Governance.

## 3. Manager

- Scoped Business-Plane operations within an assigned domain (e.g. a branch,
  inventory, or scheduling). Executes and prepares proposals; **does not hold a
  GO** — proposals await a Business GO from the Owner or Executive Director.
- No Governance Plane capability whatsoever.

## 4. Staff

- Task-level Business operations (e.g. stock counts, prep, data entry). Produces
  work and proposals for approval. **No GO.** No Governance capability.

## 5. External

- Read-restricted or single-task access, explicitly scoped (e.g. a supplier
  portal view, a limited report). **No GO.** No Governance capability. Never
  projected any Governance Data or Secret.

## 6. Authority is Plane-scoped, not seniority-inherited

A higher role has **more Business authority**, but Governance authority does
**not** flow down the hierarchy. Only the Owner holds it. This is what lets the
Executive Director be operationally powerful yet structurally unable to change the
system that governs them (see AISL-006 — Executive Director Compromise).

## Changelog

- **v1.0 — initial draft — 2026-07-12.** Five-role hierarchy; Owner in both
  planes with both GOs; Executive Director with full Business authority (incl.
  Business GO) and zero Governance authority.
- **v1.0 APPROVED — 2026-07-13.** Before-merge amendments A-01~A-10 applied; Owner approval reference: GO，Merge AISL v1.0 並轉 APPROVED — 2026-07-13
