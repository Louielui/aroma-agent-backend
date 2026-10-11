# Current Public Information v1

## Scope

Reuse A4 semantic source selection, final public-evidence obligations and the
Owner-only query planner. No parallel intent router or expanded management grant.
The Goal Decomposer catalogue now includes the existing dotted public search
operation, derived from the execution table. It provides PARTIAL field proof,
never measured weather-field guarantees, and still intersects enabled sources.
Previously this operation was absent from the planner schema and a public goal
could terminate as unmapped before the search tool was ever attempted.
The conversational Claude brain remains tool-free. A separate retrieval worker
has exactly `WebSearch`, restricted settings, no hooks/MCP/local files/shell,
no sessions, a finite 110-second deadline and four maximum turns.

Activation is explicit: `PUBLIC_SEARCH_PROVIDER=claude-subscription` in both
backend and Owner bridge configuration. Master/source/A4 flags and the bridge
token are still required. There is no API fallback. The legacy OpenAI provider
remains available only under the legacy or explicit `openai-api` configuration;
changing the conversational brain alone does not select the search provider.

## Evidence and costs

CLI initialization must report only WebSearch. Every admitted source URL must
come from a successful, matched WebSearch tool result. A final cited statement
must refer to one of these observed URLs. No tool read, malformed/error output,
unexpected tools/models or contentless bibliography produces `unavailable`,
never an invented live-zero answer. Content is a cited model summary, not a
publisher quotation. Exact source-to-summary correctness is not independently
verified by fetching page bodies. Source publication dates remain null when
not supplied; embedded times are untrusted summarized source claims.
Public-only turns show bounded excerpts of those observed summaries, links and
original retrieval time. They do not re-release model draft numerics or auxiliary
judgment. Mixed internal/public turns retain the existing answer checks and add
only provenance. Excerpts preserve uncertainty and observation times; this is
not independent confirmation of the current weather.

Current search results cache for 60 seconds, recent for five minutes, other
queries for fifteen minutes. Query/freshness/location are independent keys.
Only successful evidence is cached, in memory, bounded to 32 entries. Identical
in-flight requests share a read. A distinct query while busy is unavailable.
Cached evidence preserves its original retrieval timestamp, incurs no repeated
search invocation receipt, and reports zero new web calls. No polling/schedule
is introduced. CLI search may issue multiple backend searches within one tool
invocation; tool counts are not a provider billing invoice or credit total.

Search uses Claude subscription quota. Fresh dispatches have separate
`public_search` ledger receipts with observed model usage, not USD estimates.
Auth/limit failures never trigger another provider. There is no claim that
unrelated historical background jobs or website discovery changed billing.

## Verification

Regression coverage: tool/source attribution, malformed and unavailable states,
subscription-only args, billing route, closed bridge payload/authentication,
source/A4/token gates, single-flight/TTL/failed retry and invocation accounting.
The candidate real provider returned source-bound Winnipeg weather summaries.
Loaded route acceptance and boot identity belong in the separate delivery
receipt. Search retrieval time does not prove weather observation freshness.
