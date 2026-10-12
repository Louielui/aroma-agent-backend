# C4: Owner Aroma System Live Context

The shared Tool Gateway exposes two private Truth resources: `aroma.order_planning`
and `aroma.invoices`. It reuses the established `aromaSystemRead` transport and its
fixed GET path table. No production files, database schema or restaurant data are
changed. Each resource supports list, search, get and readMetadata. Page opening
does not request business data; the Owner chooses a read explicitly.

## Authority

The local page, API and chat are Owner-gated. The API also requires the same origin
and exact resource/operation/input fields. Callers cannot choose credentials, URL,
HTTP method, provider query, additional endpoints or a department. Source switches,
captured credential identity and configured destination are checked before and
after reads, after Gateway audit and before delivering a reused chat receipt.
Credentials remain inside the existing adapter and never enter Context Packs or
LLM context. This workflow invokes zero models or workers.

The existing API key's server-side read-only authorization is **not proven**. The
established adapter documents that the key can also authorize draft endpoints.
This release provides a closed GET interface with no reachable write operation;
it does not claim a read-only credential. Server-enforced credential restriction
requires a separate restaurant-system authorization change and is outside C4.
Member/Ivy business context and other endpoints remain unconnected to this gateway.

## Scope and evidence

List requests a bounded snapshot of at most 100 rows from the existing endpoint.
Search and get select within that snapshot; no unsupported provider filters are
forwarded. A missing selection is not a company-wide negative finding. Metadata
returns the fixed endpoint declaration without a provider request.

Invoices retain the reader-declared last-30-days scope on `createdAt`, not invoice
business date. Scope is not promoted to a server statement. Cap ambiguity remains
null, not false. Source totals and data-as-of dates remain null when absent.
Original dates retain their source values. Supplementary server truncation evidence
is preserved independently of reader completeness. Ranked order is only the order
of the received snapshot; no global highest-shortage claim is made.

Malformed successful responses fail unavailable rather than becoming empty data.
Only declared scalar business fields enter the pack. Audit records tool, result,
scope layer and measured count, without original rows, IDs, names or credentials.
Private business results have no shared cross-session cache. The Owner sees scope
and freshness on `/aroma-context`; fixed chat commands are `show replenishment
suggestions`, `show invoice records` and their Traditional Chinese equivalents.

## Acceptance

Red tests preceded implementation. Nonempty fixtures prove quantities, citations,
cap ambiguity, denied reads, malformed responses, credential changes, audit-time
revocation and receipt reuse. Candidate actual source reads on 2026-10-01 returned
zero order-planning rows and zero invoice rows in their endpoint scopes. Those
zeros are measured API responses, not a claim about all historical business data.
Candidate proof is `outputs/aroma-context-candidate-proof.json` in the development
workspace. Running bootCommit, actual Owner HTTP/chat, visible UI and architecture
acceptance must be recorded separately after loading the release.

Next unified sources are Calendar and Gmail. Mail history and semantic memory
completion continue independently; this release does not close memory acceptance.
