---
Version: 1.0
Status: DRAFT (awaiting Owner approval)
Classification: Governance Data — Owner-only
Approved-by: (pending Louie)
Last-Updated: 2026-07-12
---

# AISL-004 — Data Classification

Data is classified into three classes. Like tools (AISL-003), data access is
**structural**: data of a class not projectable to an actor is **never assembled
into that actor's session** — it is absent, not "hidden then refused."

## 1. The three classes

### Business Data (Business Plane)
Operational restaurant data: inventory, purchasing, recipes, suppliers, menu,
proposals, results/return-ready, reports, **finance (business)**, **HR
(business)**, scheduling, branch, central kitchen, customer, business audit.

### Governance Data (Governance Plane)
Data about Aroma itself: prompts, memory, AISL documents, policy/threshold
configuration, connector/MCP/desktop-agent/worker/workflow configuration,
security configuration, source code, repository internals, architecture,
development plan, and the permission model.

### Secrets
Credential material: `HUB_TOKEN`, API keys, connector-tokens, OAuth
client secrets, private keys, passwords. A class of its own, above Governance.

## 2. Per-role data access

| Data class | Owner | Executive Director | Manager | Staff | External |
|---|---|---|---|---|---|
| **Business Data** (incl. Finance/HR/Supplier) | ✅ | ✅ | 🔷 scoped | 🔷 scoped | 👁 single-task |
| **Governance Data** | ✅ | ❌ absent | ❌ absent | ❌ absent | ❌ absent |
| **Secrets** | 🔒 status-only | ❌ absent | ❌ absent | ❌ absent | ❌ absent |

## 3. Executive Director — the data guarantee

> **Executive Director: ✅ all Business Data (including Finance, HR, Supplier) ·
> ❌ all Governance Data · ❌ Secrets.**

Governance Data is **structurally not projected** into a non-Owner session:
prompts, memory, AISL, policy, architecture, source, and the permission model are
never assembled into an Executive Director (or lower) context. There is nothing to
read, so there is nothing to leak — even under compromise (AISL-006).

## 4. Secrets — value is NEVER output, for ANY role

- **No role — including the Owner — receives a secret value as output.** The
  Owner may see **status only** (`SET` / `UNSET` / `EMPTY` / rotation state),
  never the literal value.
- Secrets are **held locally** (e.g. the desktop agent / backend environment,
  AISL-008) and used in place (injected as needed by the holding process); they
  are never returned to a session, a model, a log, a proposal, a report, or a
  connector response.
- The Phase-2 read-only connector holds **no** secret at all (its read endpoints
  are token-free); if a future gated read required one, the holder would inject it
  locally and return only the response body — never the token.

## 5. Governance Data / Secrets are structural absences

Because Governance Data and Secrets are **never assembled** into non-Owner
sessions, no prompt, jailbreak, or injection can surface them from such a
session — the data simply is not present to be surfaced. This is the data-plane
twin of the tool-allowlist guarantee (AISL-003).

## Changelog

- **v1.0 — initial draft — 2026-07-12.** Business / Governance / Secrets classes;
  Executive Director ✅ Business Data / ❌ Governance Data / ❌ Secrets; secret
  values never output for any role (Owner status-only).
