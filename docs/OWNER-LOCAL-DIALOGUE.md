# Owner manual local dialogue

Only a same-origin chat request from the signed-in Owner's composer can use this allocation. The composer's one-use submission ID, conversation ID, pinned local model and digest, boot commit, expiry and native call reservations bind each turn. The original conversation pipeline supplies history and verifies answers. A model call for intent classification counts exactly as an answer attempt does. Each request also consumes one turn slot. Failed reservations are retained. Dedicated acceptance headers retain their own authorization requirements.

A deployment creates no allocation. Management is local to an interactive host terminal. There is no HTTP grant action. A separate Owner decision supplies the exact deployed commit, new UUID, call ceiling and window in milliseconds. From the installed repository the management entry is `node scripts/localBrain/dailyDialogue.cjs` with one of these argument lists:

- `status` to read the current grant.
- `activate <new-uuid> <boot-commit> <calls> <window-ms>` followed by confirmation of the displayed material.
- `pause <current-uuid> <boot-commit>` followed by confirmation. This stops further reservations and dispatches. An already dispatched reply can finish. Retirement of the current grant waits for entered turns to finish. A process interrupted during a turn can require separate reconciliation; the service never reclaims uncertain capacity.

The implementation accepts positive ceilings up to 128 attempts and windows up to 24 hours. Neither ceiling supplies a default. A turn uses at most 12 calls. A paused or exhausted grant cannot be reset or extended. A fresh grant needs separate activation. Grant and receipt files live under the service data directory in `owner-local-dialogue`. The regular conversation history policy still applies. The grant receipt stores sizes and hashes of model inputs and outputs rather than another copy of the chat. Cloud transport, background learning and repository work cannot consume this allocation.

An authenticated manual chat can ask for a fictional identifier supplied in a
complete quoted declaration, then ask for the same subject's identifier in the
immediately following turn. When the saved Owner messages establish that scope
and the normal conversation router and final verifier are enabled, business
intent voting and goal planning add no source selection. Both turns still go
through answer generation, final knowledge verification and the native budget.
Mixed requests, attachments, unsupported wording and missing saved provenance
use the ordinary pipeline. Two verified replies in four calls are an offline
fixture result for this narrow request shape, not a default daily allowance.
