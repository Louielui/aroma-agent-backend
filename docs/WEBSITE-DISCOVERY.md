# Public website discovery from chat

The subscription chat lane now has a bounded website-discovery path before business-world
classification. It is enabled only by `XIANGXIANG_WEBSITE_FLOW=on` in both backend and bridge.
The existing red-line check runs first. Attached business context is ineligible. Both
READ_ACCESS and CONTEXT_PUBLIC_KNOWLEDGE must remain on; owner settings can stop the read.
The bounded previous owner turn and extracted target are also checked for red-line content.

A cheap candidate filter limits added classification calls to possible navigation requests.
The text-only subscription classifier sees the current and at most one preceding owner turn,
never assistant messages, recalled memory or connector records. It distinguishes public
website navigation from questions, negation, private account work and other operations.
The selected target must be an exact owner-authored substring, at most 120 characters,
without credentials, URL query data or local paths. Qualified names must retain the division,
service and region, rather than silently resolving to the parent brand.

The host dispatches that target through the bearer-authenticated loopback bridge `/website`
to a separate ephemeral Codex worker. Only hosted live web search is enabled. Shell, files,
MCP, apps, plugins and delegation remain disabled, and account preflight requires ChatGPT
subscription authentication. No paid API fallback is available. Normal chat remains text-only.

The worker has 75 seconds and at most eight web actions. Its final HTTPS URL must occur in an
observed completed web openPage item. Credentials, IP/local hosts, query strings and fragments
are refused. This proves that the discovery worker attempted to inspect the returned URL;
it does not prove unrestricted site access, successful user-browser navigation or authenticated
account access. The page content remains untrusted. Identity matching is model judgment;
the first live trial lost a division qualifier, which prompted explicit qualifier preservation.

The reply is composed by the host: a clickable entry link on success, or an explicit terminal
failure/clarification. It never claims the user's browser has already opened. The user opens
the link in a new tab. HTTPS anchors use DOM nodes, noopener, noreferrer and no-referrer.

Progress is stored atomically under the backend data directory `website-runs/<UUID>.json`.
The authenticated UI polls `/api/v1/demo/website-status/<UUID>` while its request is pending,
showing classification, searching and the terminal state alongside elapsed time. Records carry
the target, resulting URL, model and timestamped states; credentials and retrieved page bodies
are not stored. Polling does not start model work. A failure is not automatically retried.

## Acceptance and limitations

2026-09-29: the real demo HTTP route with the original owner wording returned
`https://www.costcobusinesscentre.ca/` in 28.9 seconds. The preserved target was
`costco的business centre`, and the worker recorded two web actions. The initial incorrect
parent-homepage trial was not accepted. The live proof uses subscription account usage.

Regression coverage includes owner-only context, terminal failures, invalid targets, refused
extra bridge arguments, absent openPage evidence, forbidden native tools, status polling on
the real chat route, and safe clickable link rendering. The architecture checklist describes
public discovery as connected and interactive Browser/Computer, login and purchasing as pending.

This is a public discovery worker, not a full browser operator or a Costco purchasing connector.
General research, private accounts and site interaction are outside this release. Disable new
discovery by setting XIANGXIANG_WEBSITE_FLOW=off and restarting backend and bridge. Historical
links and existing run records remain available. There is no automatic replay after interruption.
