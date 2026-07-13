---
Version: 1.0
Status: DRAFT (awaiting Owner approval)
Classification: Governance Data — Owner-only
Approved-by: (pending Louie)
Last-Updated: 2026-07-12
---

# AISL-009 — Human Relay Removal Roadmap

The sequenced path to removing Louie as the manual message bus between AIs, while
keeping every step governed, read-before-write, and fail-closed. Each step is
**separately approved** by the Owner before it is built; this document is the plan,
not an authorization to build.

## The sequence

### 1. AISL v1.0 (this document set) — the constitution FIRST
Establish the governance architecture (planes, roles, policy, tools, data, GOs,
invariants, threat model, runtime, roadmap) before any autonomous wiring. Nothing
autonomous is built until the constitution it must obey exists and is Owner-approved.

### 2. Phase-2 read-only MCP connector
A co-located, origin-authenticated, **read-only** connector exposing exactly five
tools (`get_health`, `list_proposals`, `get_proposal`, `get_return_ready`,
`get_result`). Holds **no** `HUB_TOKEN`, has **no** write/dispatch path, and is
fail-closed. Backend stays loopback-private. (Design: AISL-008; Phase-2 audits.)

### 3. Aroma Desktop Agent
A **background Windows-Service-registerable process** on AromaBrain with **no UI**.
It hosts the backend + connector, custodies secrets locally, and brokers Claude
Code handoff / worker execution — all **subordinate to AISL / B2-9 / claim / GO**
(AISL-008 §2). Still no autonomous write.

### 4. ChatGPT → MCP → Desktop Agent → backend → return-ready READ loop
Close the **read** direction: 香香, from the ChatGPT MCP app, actively fetches
"what came back" (return-ready / result) through the governed connector and
desktop agent, and summarizes it for the Owner's decision. Louie stops relaying
results by hand. **Still read-only** — no write is introduced here.

### 5. GO-gated WRITE tools (the first write)
Introduce write capability (e.g. confirm) **behind the GO model**: each write is
one explicit, plane-scoped GO (Business GO for Business writes; Governance GO,
Owner-only, for any Governance change). This reintroduces `HUB_TOKEN` custody
(injected locally, never exposed) and full B2-9 governance. This is the first step
that lets 香香 trigger action — and it is fully gated.

### 6. Desktop UI / system tray — LAST
Only after the governed read and write loops are proven does a **desktop UI /
system-tray** surface get added, as a convenience layer on top of the already-
governed agent. UI is last, never a prerequisite for governance.

## Ordering principles

- **Constitution before capability** — AISL exists before any autonomous wiring.
- **Read before write** — every read loop is closed and proven before any write is
  introduced.
- **Gate every write** — writes arrive only behind the plane-scoped GO model.
- **UI last** — surfaces are added after governance is in place, never before.
- **Each step separately approved** — this roadmap plans; the Owner authorizes
  each step at build time.

## Changelog

- **v1.0 — initial draft — 2026-07-12.** Six-step Human Relay Removal roadmap:
  AISL → read-only connector → desktop agent → read loop → GO-gated writes → UI
  last.
