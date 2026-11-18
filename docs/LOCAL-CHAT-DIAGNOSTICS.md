# Local chat diagnostics and workbench status

The 2026-11-18 read-only snapshot reproduced a paused local budget refusal being
mapped to an unexplained internal error. Historical attribution of the Owner's
three failed chat requests remains unknown: native service logs were inaccessible.
This change does not replay those requests or grant permission for inference.

UsageBudget now throws a typed host error. A finite allowlist at the existing
intake disclosure boundary returns safe non-retryable usage codes, fixed messages
and the existing correlation ID. Unknown codes and same-name/code impostors remain
generic internal errors. Locks, reservations, pause/expiry/caps, evidence writes,
selection and activation semantics are unchanged. There is no automatic resume,
new root, quota, retry, substitution or cloud fallback. The chat renders the safe
usage code and correlation ID beside the message when that receipt is present.

In local mode the old worker workbench reads only closed control metadata and
Sandbox prerequisites. It avoids the prohibited subscription worker adapter.
Local connection, unavailable/unknown prerequisites, and unverified guest isolation
are distinct. A metadata response never proves fresh inference, subscription
login, App visibility or successful repair. It never authorizes execution.
The old start/review controls are hidden and disabled; the server refuses every
legacy POST in local mode. Project Tasks remains the existing per-work approved
entry. Auth, same-origin checks, no-cloud boundary and historical evidence remain.
Metadata freshness and source/model binding are required; missing/stale/drifted
control evidence fails closed. No credentials, native CLI path or raw error text
is copied into the workbench response. Local polling is every thirty seconds.

Offline tests use fake transport/stores or an isolated HTTP server. No production
intake, model inference, Sandbox guest, source card or ledger is started. Native
programming acceptance remains failed/incomplete, including the preceding case
draft's missing baseline rejection assertions and incorrect maximum expectation.
Deployment requires a separate exact-source Owner package approval. Any subsequent
real inference needs a separately approved bounded root; all 21 old ledgers and
automatic memory remain paused.
