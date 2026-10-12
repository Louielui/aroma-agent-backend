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
no sessions, a shared finite 110-second deadline and four maximum search turns.
The host then reads at most two observed URLs on six registered official hosts
using HTTPS GET, with at most two registered redirects per page, bounded bodies,
public DNS addresses, no credentials/cookies/referrer, and no script execution.
Public Source Fallback v1 adds subject-bound embedded JSON-LD, same-host alternate
JSON and a fixed library JSON directory referenced by registered official pages.
At most two additional source reads share the existing 110-second deadline; see
`PUBLIC-SOURCE-FALLBACK-V1.md` for coverage, egress and usage boundaries.
An observation over two hours old gets one bounded read-back. Failure keeps the
earlier dated page and an explicit failed check, never a new-time substitute.
A separate tool-free subscription composition call translates exact matched
quotes into the host-selected answer language. Host language is presentation
metadata derived from the Owner message; the three-field meaning schema and
Owner-only query authoring remain unchanged.

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
publisher quotation. Registered official publisher bodies are now read separately.
Every composed statement must carry an exact quote from a captured page or from
an explicitly labelled search summary; extra Arabic numbers and wrong-language
answers are withheld. Matching proves quotation presence, not every translation,
semantic inference, source truth or completeness. Omitted statements are visible.
HTML scripts/styles are removed without execution; whitespace and degree-unit
spacing are normalized before quote matching. Published, updated, observation and
forecast times are separate typed values from explicit metadata/time markup.
Unknown dates remain unknown; the generic page-modified footer never becomes
today's weather observation. Public-only replies lead with at most three admitted
statements and visible freshness limits. Source quotations and checks are
collapsed in the UI, retained in the reply/history/copy. Mixed internal/public
turns retain existing answer checks and add only provenance.

Current search results cache for 60 seconds, recent for five minutes, other
queries for fifteen minutes. Query/freshness/location/replyLanguage are independent keys.
Only successful evidence is cached, in memory, bounded to 32 entries. Identical
in-flight requests share a read. A distinct query while busy is unavailable.
Cached evidence preserves its original retrieval timestamp, incurs no repeated
search invocation receipt, and reports zero new web calls. No polling/schedule
is introduced. CLI search may issue multiple backend searches within one tool
invocation; tool counts are not a provider billing invoice or credit total.

Search uses Claude subscription quota. Fresh dispatches have separate
`public_search` ledger receipts with observed usage from discovery and composition,
not USD estimates. Failed composition preserves observed search usage as partial
evidence rather than relabelling it as zero usage.
Auth/limit failures never trigger another provider. There is no claim that
unrelated historical background jobs or website discovery changed billing.

## Verification

Regression coverage: tool/source attribution, malformed and unavailable states,
subscription-only args, billing route, closed bridge payload/authentication,
source/A4/token gates, single-flight/TTL/failed retry and invocation accounting.
The first cross-domain candidate exposed a legacy website-navigation misroute:
a factual source question was answered with a URL and used the Codex website
worker. Navigation now requires a separately declared website-URL deliverable;
factual/ambiguous output falls through to the existing query architecture. This
does not migrate the explicitly requested legacy navigation worker's billing.
Candidate and loaded real cross-domain acceptance are recorded separately.
The previous isolated real Express candidate passed Chinese and English weather, the
observed Manitoba release listing, and honest gap handling for Millennium Library.
All four final candidate replies used Claude Opus 5.5. The library's official HTML
loads its hours through scripts, which this bounded reader does not execute; hours
remained unestablished in that previous version. This was not a successful
opening-hours retrieval; new structured-source acceptance is recorded separately. English
weather withheld two unmatched statements and kept that omission visible. The
government result establishes what the observed listing says, not a complete
inventory of every announcement. None of these candidate results proves deployment.
Loaded route acceptance and boot identity belong in the separate delivery
receipt. Search retrieval time does not prove weather observation freshness.
