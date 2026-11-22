# Local chat public catalogue search

The first release covers foreground Owner questions about an approved product, depth, retailer and city. For example, the Owner can ask “幫我查 Winnipeg Costco 有冇 8 吋深嘅 bus tub”. The desktop chat checks same-thread recall first. Public search uses a distinct, expiring grant and the existing local dialogue grant. Both must admit the turn.

## Network and answer boundaries

- The authenticated backend sends three identifiers to the Owner Bridge over the fixed loopback RPC. The Bridge reconstructs the query from the exact SHA-256-approved product name, depth, city and retailer. It sends those public fields, freshness and query time to the existing Claude subscription WebSearch worker. This is external discovery. Qwen is the only answer model, and there is no cloud answer fallback.
- A request prefixed with “根據我哋倉存” must match exactly one approved item in a complete inventory response from the existing read-only Aroma System adapter. Its private reference, SKU, quantity, cost, supplier, the question, history and memory stay out of the RPC, discovery input and Qwen evidence prompt. Inventory matching uses an existing read permissions check.
- The discovery worker can use the existing maximum of three WebSearch calls. The existing publisher reader follows its scoped HTTPS checks and reads at most two initial and two additional candidates. It returns read publisher text and the corresponding URL, time and digest. A search summary cannot become an original-page quote.
- Pinned local Qwen3.5 9B selects a short verbatim quotation. The host matches the quotation to that page, renders the Cantonese answer with its source link, and reports the actual retrieval time in UTC. The pilot only establishes catalogue evidence. It has no store-inventory connector and always reports branch stock as unconfirmed.
- The grant can admit at most three requests, including failed or interrupted reservations, and expires after at most 30 minutes. The durable receipt precedes dispatch, rejects replay and stops further use after a failed or unresolved attempt. The native worker binds one discovery invocation to one reserved request. Legacy budget rules still govern other invocations. The existing invocation ledger records provider usage with the same request ID. Local inference remains in the existing manually authorized per-message dialogue budget.

## Separate authorization

Code installation leaves public egress disabled. Enablement requires an exact release-bound grant in the deployment data directory under `local-public-search/approval.json` and its exact byte fingerprint supplied via `XIANGXIANG_LOCAL_PUBLIC_SEARCH_GRANT_SHA256` to both processes. Keep those materials outside the repository and protected by the existing service/Owner access boundary. A grant contains `id`, `commit`, UTC millisecond `startsAt` and `expiresAt`, `limit`, and `items`. Each item contains `id`, `product`, `depthInches`, `retailer`, `city` and an optional private binding represented by `inventoryRef: null` when unused. Review actual material and outbound fields before activation.

Removing the approval file stops admission of new requests immediately. It does not erase the receipt or guarantee the cancellation of an already dispatched request. Keep original evidence and let it settle within its deadline. An expired or revoked grant is not renewed automatically.

The mock tests cover Owner intake wiring, same-thread recall, Cantonese routing, the inventory projection, source provenance, no inferred store stock, bounded calls, failure, expiry and unchanged legacy search behavior. The real outbound search, publisher access and the Qwen response still need a separately approved pilot.
