---
Version: 1.0
Status: APPROVED
Classification: Governance Data — Owner-only
Approved-by: Louie
Approval date: 2026-07-13
Last-Updated: 2026-07-12
---

# AISL-002 — Permission Matrix

The full resource × role matrix across **both planes**. Legend:

- ✅ = the role has ordinary permission within that Plane and may independently
  complete ordinary, non-High-Risk actions within that permission. All operations
  remain subject to the Policy Layer, High-Risk gates, absolute redlines, audit,
  and applicable approval requirements.

  For the Executive Director, a ✅ does not override action-level risk
  classification. Within Finance, HR, delete, export, or any other Business
  domain, an action classified as High-Risk may be initiated by the Executive
  Director but MUST NOT be completed independently when the applicable Policy
  requires second confirmation, dual approval, or Owner approval.

  The presence of a ✅ MUST NOT cause an entire resource category to be treated as
  High-Risk. Risk is evaluated at the action level according to Policy.
- 🔷 scoped / execute-and-propose (no GO)
- 👁 read-only
- ❌ no access — **structurally absent** from the session, not refused
- 🔒 status-only, value never output

> **Precedence:** a resource's **Plane** is authoritative and evaluated before
> role (AISL-007). Governance-Plane cells are ❌ for every non-Owner role by
> construction.

## 1. Business Plane

| Resource | Owner | Executive Director | Manager | Staff | External |
|---|---|---|---|---|---|
| Inventory | ✅ | ✅ | 🔷 | 🔷 | ❌ |
| Purchasing / ordering | ✅ | ✅ | 🔷 | 🔷 | ❌ |
| Recipe | ✅ | ✅ | 🔷 | 🔷 | ❌ |
| Supplier | ✅ | ✅ | 🔷 | 👁 | 👁* |
| Menu | ✅ | ✅ | 🔷 | 👁 | ❌ |
| Proposal (business) | ✅ | ✅ | 🔷 | 🔷 | ❌ |
| Result / return-ready | ✅ | ✅ | 👁 | 👁 | ❌ |
| Reports | ✅ | ✅ | 🔷 | 👁 | 👁* |
| Finance (business ops) | ✅ | ✅ | 👁 | ❌ | ❌ |
| HR (business ops) | ✅ | ✅ | 🔷 | ❌ | ❌ |
| Scheduling | ✅ | ✅ | 🔷 | 🔷 | ❌ |
| Branch | ✅ | ✅ | 🔷 | 👁 | ❌ |
| Central kitchen | ✅ | ✅ | 🔷 | 🔷 | ❌ |
| Customer | ✅ | ✅ | 🔷 | 👁 | 👁* |
| Business audit (read) | ✅ | ✅ | 👁 | 👁 | ❌ |

\* External access is single-task/scoped and explicitly provisioned per case.

**Executive Director on the Business Plane: ✅ across the board** (with High-Risk
items subject to Policy-Layer gating — AISL-005, not shown as a cell because it is
a gate on the action, not a change in plane).

## 2. Governance Plane

| Resource | Owner | Executive Director | Manager | Staff | External |
|---|---|---|---|---|---|
| Modify Aroma (behavior) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Prompt / system prompt | ✅ | ❌ | ❌ | ❌ | ❌ |
| Memory | ✅ | ❌ | ❌ | ❌ | ❌ |
| AISL documents | ✅ | ❌ | ❌ | ❌ | ❌ |
| Policy (thresholds, gates) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Connector | ✅ | ❌ | ❌ | ❌ | ❌ |
| MCP app | ✅ | ❌ | ❌ | ❌ | ❌ |
| Desktop agent | ✅ | ❌ | ❌ | ❌ | ❌ |
| Workflow engine | ✅ | ❌ | ❌ | ❌ | ❌ |
| Worker | ✅ | ❌ | ❌ | ❌ | ❌ |
| Security | ✅ | ❌ | ❌ | ❌ | ❌ |
| Secrets | 🔒 | ❌ | ❌ | ❌ | ❌ |
| Source code | ✅ | ❌ | ❌ | ❌ | ❌ |
| Repository | ✅ | ❌ | ❌ | ❌ | ❌ |
| Architecture | ✅ | ❌ | ❌ | ❌ | ❌ |
| Development plan | ✅ | ❌ | ❌ | ❌ | ❌ |
| Permission model | ✅ | ❌ | ❌ | ❌ | ❌ |

**Executive Director on the Governance Plane: ❌ for every resource.** These
tools and data are not present in an Executive Director session (AISL-003,
AISL-004). Even the Owner receives **Secrets** as 🔒 status-only — the value is
never output to any role (AISL-004 §3).

## 3. The one-line summary

> **Executive Director = ✅ all Business Plane · ❌ all Governance Plane.**
> **Owner = the only actor in both planes; the only holder of the Governance GO.**

## Changelog

- **v1.0 — initial draft — 2026-07-12.** Full two-plane permission matrix;
  Executive Director ✅ Business / ❌ Governance; Secrets status-only even for Owner.
- **v1.0 before-merge amendment — 2026-07-12.** A-06: Owner-approved replacement of
  the ✅ legend — ✅ = ordinary permission subject to Policy/High-Risk/redlines/audit/
  approvals; for the Executive Director a High-Risk action may be initiated but not
  completed independently when Policy requires it; a ✅ never makes a whole resource
  category High-Risk (risk is action-level). (Status remains DRAFT.)
- **v1.0 APPROVED — 2026-07-13.** Before-merge amendments A-01~A-10 applied; Owner approval reference: GO，Merge AISL v1.0 並轉 APPROVED — 2026-07-13
