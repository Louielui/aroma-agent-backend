---
Version: 1.0
Status: DRAFT (awaiting Owner approval)
Classification: Governance Data — Owner-only
Approved-by: (pending Louie)
Last-Updated: 2026-07-12
---

# AISL-008 — Runtime Architecture

The three layers that carry the Aroma Runtime. Each is **subordinate to AISL**:
none is an authorization layer of its own; they operate inside the boundaries the
six-layer chain (AISL-v1.0 §3) and the invariants (AISL-007) define.

```
  ┌─────────────────────────────────────────────────────────────┐
  │  ChatGPT MCP App  — 香香's natural-language entry point       │
  │  (via the governed read-only connector; never touches         │
  │   backend / repo / HUB_TOKEN / files directly)                │
  └───────────────┬─────────────────────────────────────────────┘
                  │  authenticated HTTPS ingress → governed connector
                  ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Aroma Desktop Agent  — resident background process on        │
  │  AromaBrain: hosts the backend + read-only connector,         │
  │  custodies secrets, brokers Claude Code handoff and worker    │
  │  execution.  An OPERATIONS layer, NOT an authorization layer.  │
  └───────────────┬─────────────────────────────────────────────┘
                  │  loopback 127.0.0.1:8081, governed by AISL / B2-9 / claim / GO
                  ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Aroma Web Console  — the primary management UI (unchanged;   │
  │  not replaced by any of the above)                            │
  └─────────────────────────────────────────────────────────────┘
```

## 1. Aroma Web Console

- The **primary management UI**, as it exists today. **Not replaced** by the
  desktop agent or the MCP app — those are additional entry points, not a
  substitute for the console.
- Owner and roles manage Aroma and the business here under the normal permission
  model.

## 2. Aroma Desktop Agent

- A **resident background process on AromaBrain** (the host). It **hosts the
  backend and the read-only connector**, holds **secret custody** locally (never
  emitting values — AISL-004 §4), and brokers **Claude Code handoff** and
  **worker execution**.
- **Subordinate to AISL, B2-9, the claim gates, and the GO model.** It is an
  **operations layer, not an authorization layer**: it carries out authorized work
  and enforces structural boundaries, but it does not itself decide authorization
  — that remains with the six-layer chain and the GOs.
- It exposes **no UI** in its first form (AISL-009 step 3); it is a background
  process, registerable as a Windows Service.
- All execution it brokers stays gated: nothing runs without passing B2-9
  authorization and the claim gates; nothing Governance happens without the
  Owner's Governance GO.

## 3. ChatGPT MCP App

- 香香's **natural-language entry point**. It reaches Aroma **only through the
  governed read-only connector** over an authenticated HTTPS ingress.
- It **never touches** the backend directly, the repository, `HUB_TOKEN` or any
  secret, or the filesystem. It sees **only** what the connector's read-only tool
  allowlist returns.
- In its first form it is **read-only** (health, proposals, return-ready, result).
  Write/GO-gated tools are a later, separately-approved step (AISL-009 step 5).

## 4. Layering discipline

- **Authorization lives in AISL** (planes, roles, policy, tools, data, GOs), not
  in any runtime component.
- The desktop agent and connector **enforce structural boundaries** (loopback
  isolation, read-only allowlist, secret custody, fail-closed) but **derive** their
  permitted actions from AISL — they never expand them.
- The console remains the human management surface; the MCP app and desktop agent
  extend reach for 香香 without widening authority.
- **Non-Bypass (INV-16 Non-Bypass Enforcement, AISL-007):** no operation from any
  of these three layers — UI, Desktop Agent, MCP, worker, direct API, or background
  jobs — may bypass the Plane → Role → Policy → Tool → Data → LLM enforcement chain,
  and no operation may skip the chain because it originates from an internal service
  or an Owner session.

## Changelog

- **v1.0 — initial draft — 2026-07-12.** Three-layer runtime: Web Console
  (primary UI, unchanged) / Desktop Agent (resident ops layer, secret custody,
  subordinate to AISL) / ChatGPT MCP App (NL entry via governed connector, never
  touches backend/repo/secrets/files).
- **v1.0 before-merge amendment — 2026-07-12.** A-04: added an INV-16 Non-Bypass
  Enforcement cross-reference to §4 — no runtime layer may bypass the enforcement
  chain or skip it via internal-service/Owner-session origin. Additive; no existing
  clause changed. (Status remains DRAFT.)
