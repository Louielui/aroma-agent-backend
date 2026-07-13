---
Version: 1.0
Status: APPROVED
Classification: Governance Data — Owner-only
Approved-by: Louie
Approval date: 2026-07-13
Last-Updated: 2026-07-12
---

# AISL v1.0 — Aroma Intelligence Safety Layer

> The governance constitution for the Aroma Runtime. It is versioned with the
> backend (`aroma-agent-backend`) so that git history becomes the formal,
> auditable governance record. Every change to how Aroma may be commanded,
> modified, or trusted is a change to this document set — and therefore a
> Governance action.

## 1. Purpose

AISL defines **who may command Aroma, what they may command, and how those
commands are structurally constrained** — so that autonomous coordination (香香
acting across AIs and systems) can grow without ever letting a command,
compromise, or prompt-injection reach beyond its authorized boundary.

AISL is not advice to the model. It is an **enforcement architecture**. The model
is never trusted to police itself.

## 2. Core principle — enforcement is STRUCTURAL, not prompt-based

The single load-bearing idea of AISL:

> **A role cannot do what its session has no tool or data path to do.**

Authorization is enforced by **which tools and which data an actor's session
physically contains** — not by instructions telling the model to refuse. A
Governance tool absent from an Executive Director's session is not "refused when
asked"; it **does not exist in that session**. There is no prompt to jailbreak,
because there is no capability to unlock.

This is why AISL survives a compromised account, a prompt injection, or a
confused model: the missing capability was never present to be abused.

## 3. The Six-Layer Enforcement Chain

Every command Aroma receives passes through six layers, **in order**. A command
must clear each layer to reach the next; failing any layer fails closed.

```
  1. Identity   — WHO is this actor? (authenticated principal)
        ↓
  2. Role       — WHAT role do they hold? (Owner > ExecDir > Manager > Staff > External)
        ↓
  3. Policy     — do extra POLICY gates apply? (threshold, dual-approval,
                   office-hours, geo, maintenance-mode, spending-limit)
        ↓
  4. Tool Allowlist — is the requested TOOL present in this session? (structural)
        ↓
  5. Data Allowlist — is the requested DATA class projectable to this actor? (structural)
        ↓
  6. LLM        — only now does the model reason, bounded by 1–5
```

Layers 4 and 5 are the structural core: even if an attacker forged intent past
1–3, the tool and data simply are not in the session. The LLM (layer 6) is the
**last** and **least-trusted** layer — it operates only inside the box the first
five layers built.

> **Precedence rule (see AISL-007):** before Role (layer 2) is evaluated, the
> command's **Plane** (Business vs Governance) is classified. Plane is
> authoritative and evaluated FIRST. Never reverse-derive Plane from Role.

## 4. The Two-Plane Model

Every resource, tool, datum, and GO belongs to exactly one **Plane**:

- **Business Plane** — running the restaurant business: inventory, purchasing,
  recipes, suppliers, menu, proposals, results, reports, finance, HR,
  scheduling, branches, central kitchen, customers, business audit. This is the
  operational surface where the business is run day to day.

- **Governance Plane** — modifying Aroma itself: prompts, memory, the AISL
  documents, policy, connectors, MCP apps, the desktop agent, workers, the
  workflow engine, security, secrets, source code, the repository, architecture,
  the development plan, and the permission model. This is the surface where the
  system that runs the business is changed.

**The planes are isolated by construction.** A non-Owner session contains only
Business-Plane tools and data; Governance-Plane capability is **structurally
absent** from it. The Owner is the only actor present in **both** planes.

Why two planes: it lets the Executive Director run the entire business
autonomously (full Business authority, including the Business GO) while being
**structurally unable** to change, clone, or subvert Aroma itself. Operational
power and self-modification power are different kinds of power and are separated.

## 5. Document Index

| Doc | Title | Scope |
|---|---|---|
| **AISL-v1.0** | This master document | Purpose, six layers, two planes, index |
| **AISL-001** | Role Hierarchy | Owner > ExecDir > Manager > Staff > External |
| **AISL-002** | Permission Matrix | Full resource × role matrix, both planes |
| **AISL-003** | Tool Allowlist | Tiers T1–T4, plane classification, per-role visibility |
| **AISL-004** | Data Classification | Business Data / Governance Data / Secrets |
| **AISL-005** | GO Model | Plane-scoped GO; Policy Layer; High-Risk gating |
| **AISL-006** | Threat Model | Incl. Executive Director Compromise containment |
| **AISL-007** | Governance Invariants | Constitutional, non-negotiable rules |
| **AISL-008** | Runtime Architecture | Web Console / Desktop Agent / ChatGPT MCP App |
| **AISL-009** | Roadmap | Human Relay Removal sequencing |

## 6. Status & Authority

This set is **DRAFT** until the Owner (Louie) approves it. Until approved it
documents intent; it does not itself grant or revoke any capability. No code,
runtime, permission, connector, MCP, authentication, or authorization behavior is
created or changed by these documents — they are the governing specification that
future, separately-approved implementation must conform to.

### DRAFT → APPROVED transition

A document transitions from DRAFT to APPROVED only upon explicit Owner approval.
Merge does not equal automatic approval unless the merge brief explicitly contains
an Owner approval reference. Approved-by, Approval date, version, and changelog
MUST be updated together. An unapproved version MUST NOT be treated as formal
authority by any runtime or implementation.

## 7. Deferred to Implementation Specification

The following are deferred to the implementation specification and are NOT fixed in
this AISL v1.0 constitution: nonce format, payload hash method, expiry duration,
threshold amounts, cumulative window length, storage technology, cryptographic
implementation. These MUST be defined in the future implementation specification
but MUST NOT violate the constitutional principles above.

## Changelog

- **v1.0 — initial draft — 2026-07-12.** First AISL constitution: six-layer chain,
  two-plane model, plane-scoped GO, Policy Layer, and the AISL-001–009 set.
- **v1.0 before-merge amendment — 2026-07-12.** A-09: added the DRAFT → APPROVED
  transition rule (merge ≠ auto-approval; Approved-by/date/version/changelog updated
  together). A-10: added §7 "Deferred to Implementation Specification" (nonce,
  payload hash, expiry, thresholds, window, storage, crypto). Additive; no existing
  clause changed. (Status remains DRAFT.)
- **v1.0 APPROVED — 2026-07-13.** Before-merge amendments A-01~A-10 applied; Owner approval reference: GO，Merge AISL v1.0 並轉 APPROVED — 2026-07-13
