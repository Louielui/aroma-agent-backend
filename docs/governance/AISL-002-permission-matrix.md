---
Version: 1.0
Status: DRAFT (awaiting Owner approval)
Classification: Governance Data — Owner-only
Approved-by: (pending Louie)
Last-Updated: 2026-07-12
---

# AISL-002 — Permission Matrix

The full resource × role matrix across **both planes**. Legend:

- ✅ full authority (incl. approve/GO where applicable)
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
