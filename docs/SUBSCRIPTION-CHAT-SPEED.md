# Subscription chat speed and thinking levels

Owner-authorized on 2026-09-29. The chat model and subscription billing remain
GPT-6 Astra through the personal Codex App Server bridge.

## Controls

The subscription composer offers Fast (low), Standard (medium) and Deep (high).
Fast is the default. Selection stays in the current page and applies to subsequent
chat turns until changed or the page reloads. It is disabled while sending.
The server validates the closed level list before acquiring an adapter. Other
lanes do not receive the setting. Control/verifier model bindings are unchanged.

The waiting indicator reports actual elapsed seconds. It does not invent progress
stages. Answers still arrive after the existing validation pipeline completes;
this change does not stream unverified generated content into the conversation.

## Transport

The bridge reuses one initialized, serialized Codex process for up to 90 seconds
of inactivity or 16 operations. Each completion still creates a new ephemeral
thread with no tools or execution environment. Account type, exact model,
subscription limits, configured MCP tools and tool absence are checked again.
No conversation history is shared through process reuse.

Cancellation, transport failure or a 120-second operation timeout discards the
connection. A subsequent explicit request reconnects. Failed work is never
automatically replayed and never falls back to a paid API. Listener cleanup,
timeouts and per-operation serialization are covered by injected-RPC tests.

## Narrow social fast path

Only subscription chat with an authoritative CONVERSATION route and a complete
phrase in the closed social vocabulary can qualify. History must be empty or
contain only this exact user message (the existing browser sends that shape).
Attached context and earlier conversation turns keep the full pipeline.

The fast path skips semantic fallback, retrieval/recall, goal decomposition and
the final knowledge verifier. It retains persona, red-line checks, response
parsing, language/honesty checks, route finalisation and conversation persistence.
A generated read request, plan, task or non-chat mode is rejected before it can
reach execution. Compound messages such as a greeting followed by a purchase,
mail, deployment or inventory request never qualify. Other providers retain the
existing pipeline; the original L2-A telemetry remains observational.

## Validation and rollout

Tests exercise real HTTP level validation and lane separation, generated effort
parameters, fresh thread identity, process reuse, abort/failure reconnect,
timeouts, listener cleanup, and one-call social turns with no auxiliary reads or
models. Browser fixture checks verify the selector, backend receipt of Deep,
busy controls and elapsed-time indicator.

Live timings from transport-only checks are not end-to-end chat measurements.
Confirm the resident service boot commit after restart and test via the real
owner-authenticated `/api/v1/demo/intake` route before claiming live acceptance.
Restart the user-session bridge as well as AromaXiangXiangBackend on rollout.
Rollback by reverting this commit and restarting both; no data migration exists.

Official protocol reference: https://learn.chatgpt.com/docs/app-server
