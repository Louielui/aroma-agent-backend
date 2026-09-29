# Codex subscription chat

The opt-in `CHAT_BACKEND=codex-subscription` setting routes the chat lane to
`gpt-6-astra` through the official Codex App Server and the owner's existing
ChatGPT login. It overrides stale browser provider hints. Proposal, email,
classification, verification and other worker roles keep their existing settings
and may still incur API charges. This is not a migration of every model call.

## Runtime

The Windows backend runs as LocalService. A separate bridge runs in the owner's
signed-in Windows session and listens only on `127.0.0.1:8091`. The backend
authenticates with an independent random 256-bit token. Codex OAuth credentials
remain in the owner's Codex installation; they are not copied to LocalService.
The bridge is unavailable while the owner is signed out.

Repository `.env` settings (never commit their values):

- `CHAT_BACKEND=codex-subscription`
- `CODEX_CHAT_BRIDGE_TOKEN`: 64 lowercase hexadecimal characters, generated randomly.
- `CODEX_CHAT_EXECUTABLE`: absolute path to the installed native `codex.exe`.

Run `scripts/subscription/startBridge.ps1` as the owner. An optional per-user
Startup shortcut runs this supervisor after login. It restarts an exited bridge
and stores only startup/error messages beneath LocalAppData. Restart the backend
service after configuration changes, then reload the browser.

## Boundaries

- ChatGPT authentication, exact model availability and subscription quota are
  checked before source reads/auxiliary calls, and again before each completion.
- Exhausted/unknown quota, missing login/model, connection failure or invalid
  output stops the chat. There is no Claude or OpenAI API fallback for this lane.
- The bridge strips API credentials and Node startup hooks from the child
  environment. Each completion uses an ephemeral thread, an empty working
  directory, no execution environments, no dynamic tools, and disabled shell,
  plugins, hooks, apps, web search and MCP tools. Unexpected tool requests fail.
- Host-side source sharing, persona, history, answer parsing and approval gates
  remain responsible for the conversation. Context sent to the model goes to
  OpenAI. Ephemeral threads do not imply zero retention by the provider.
- The bridge accepts one request at a time, bounds input/output size and cancels
  on client disconnect. Each App Server process has a 120-second timeout.
- App Server does not expose the API adapter's `maxTokens`/temperature controls.
  This adapter uses low reasoning effort, an optional output schema and a bounded
  response size; it does not claim a provider-enforced output token ceiling.
- Subscription tokens are not entered into the API-cost ledger. They remain in
  per-turn model telemetry. Account quota is shared with other Codex use. Account
  credits/billing settings remain managed by OpenAI; this bridge does not change
  them or purchase credits.

## Rollback

Remove `CHAT_BACKEND` (or set it to `api`) and restart the backend to restore the
previous provider-selection behavior. This explicitly restores paid API routing.
Remove the per-user Startup shortcut and stop its supervisor to retire the bridge.
Keep the previous `.env` backup private. No database migration is needed.

## Validation

Run `node --test src/subscription/*.test.js src/routing/modelRouter.test.js
src/routing/providerHint.test.js`, then the repository's full `node --test` suite.
Tests use fake transports and providers. Live probes must be explicit and use a
small non-business prompt; they consume subscription quota.

Official references: [App Server](https://learn.chatgpt.com/docs/app-server),
[authentication](https://learn.chatgpt.com/docs/auth),
[models](https://learn.chatgpt.com/docs/models).
