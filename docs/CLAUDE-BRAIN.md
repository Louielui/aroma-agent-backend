# Claude subscription brain

Chat defaults to the Claude Sonnet subscription alias and Medium effort. The
composer also lists the four existing GPT choices. A browser-local preference
stores only an allowlisted model identifier; no message, credential or approval
is stored there. Subsequent chat, image and dialogue planning requests bind the
selection. Old tabs must reload after delivery.

The loopback bridge runs Claude Code under the signed-in Owner using the existing
sanitized child environment. API keys are excluded. Auth must report claude.ai
and firstParty, without an API-key source. Tools, MCP, hooks and session persistence
are disabled. Prompts and image pixels are passed on stdin, not shell arguments.
Sonnet completion provenance is checked; separately accounted Claude Code Haiku
helpers are allowed, but a substitute Opus or absent Sonnet result is refused.
There is no provider fallback, automatic retry, API fallback or new execution
authority. Native JSON-schema formatting and existing host result validation apply.

The bridge's Hindsight completion lane and mail triage use Claude independently
of the browser choice. Existing queue data and quota backoff are preserved; no
state reset or forced reindex occurs. Existing fixed Codex coding/test workers,
website discovery and other registered specialist roles retain their contracts
and credit policy. Choosing Claude for chat does not migrate those workers.
Claude subscription exhaustion/auth errors stop the Claude call. Account-level
Claude extra-usage settings are not changed by this feature.

Verification: claudeBrain.test.js covers auth, provider/billing mismatches,
structured image stdin and bridge routing with unavailable GPT. shellBoot.test.js
executes the assembled bilingual UI and checks selection persistence and forged
values. The full repository suite covers existing approval and execution fences.
