# Tool Gateway v1: public GitHub development context

Owner authorized this phase on 2026-10-01. Existing Memory completion remains a
separate, unfinished acceptance gate. This release preserves that ingestion and
does not connect a business write surface.

## Implemented scope

`src/context/toolGateway.js` wraps the established `readConnector`. It exposes
`search`, `list`, `get` and `readMetadata` against a server-owned resource registry.
Unsupported operations, additional request keys and non-Owner actors are refused
before retrieval. The HTTP workflow accepts an empty JSON object: callers cannot
select a repository, URL, credential, role, model or executable command.

Context Packs preserve source IDs, source dates, retrieval time, links, sensitivity,
access scope, query scope, pagination/truncation, completeness and inspected SHA.
Missing dates, totals and failed counts remain unknown. Retrieved content is data,
never instructions; there is no model or dispatcher in this lane. Metadata-only
audit uses exclusive event files in `context-activity`. A failed audit blocks the
operation, including a successful source read whose result cannot be recorded.

## GitHub boundary

The configured `GITHUB_READ_REPO` is the only repository in this phase. Its metadata
must prove it is public. The new adapter constructs an anonymous Octokit client;
it does not accept or reuse `GITHUB_READ_TOKEN`, browser sessions or other secrets.
The existing authenticated adapter is preserved for its established consumers.
Private repository permission acceptance is still pending: possession of a token
or its variable name is not permission evidence.

Seven fixed GET routes cover repository metadata, ten recent default-branch
commits, ten recently updated PRs targeting that branch, latest check runs and
commit statuses at the inspected remote SHA, a single SHA-bound commit and
repository-bound PR title search. Search syntax cannot introduce another scope.
Provider pagination and totals are retained. This is a bounded sample, not the
repository's entire development history or a completeness percentage.

Checks/statuses are read at the same SHA as the first returned commit. Empty
successful reads mean no published evidence, not tests passing. Failure, pending,
non-success conclusions and incomplete coverage remain distinct. The adapter
honors observed provider rate-limit reset/retry deadlines without retrying earlier.
Provider documentation: [check runs](https://docs.github.com/en/rest/checks/runs)
and [commit statuses](https://docs.github.com/en/rest/commits/statuses).

## Owner workflow

The sidebar and architecture inventory link to `/live-context`. Opening the page
makes no GitHub requests. An explicit button or a complete development-progress
chat command starts a read. Quoted examples, negation, compound execution requests
and Aroma System development questions do not match this fixed Xiangxiang query.
No paid model or worker call occurs. Chat persists its measured answer in existing
conversation history; matching request IDs coalesce duplicate submissions.

Repeated or concurrent requests share GitHub data for at most five minutes,
explicitly labelled with its original retrieval time. The source read switch is
checked before and after every response, including cached and in-flight data.
Local deployment HEAD is reread separately; bootCommit and bootedAt come from the
process's frozen boot evidence. Remote, deployed and running commits remain three
independent observations. A remote mismatch does not prove ancestry, failure or
completion; a deployment/runtime mismatch identifies a required reload.

## Acceptance and remaining work

Real candidate source acceptance on 2026-10-01 returned ten commits, ten PRs, zero
published checks/statuses, one verified commit and two PR search results. Seven
GET requests carried no Authorization header. Output proof is kept in the local
development workspace as `outputs/tool-gateway-source-proof.json`; source reads
alone do not confirm the local Windows service has loaded this release.

Delivery must still verify `/health` against the delivered commit and inspect the
loaded page, chat path and architecture entries. Windows service-control protection
requires the Owner if ordinary restart authority is unavailable; no bypass exists.

Owner Drive C3 now adds scoped Knowledge Context Packs and bounded supported-text
reads; see [Drive Live Context](DRIVE-LIVE-CONTEXT-V1.md) for its explicit limits.
Owner Aroma System C4 adds bounded replenishment/invoice Truth Context Packs;
see [Aroma Live Context](AROMA-LIVE-CONTEXT-V1.md) for its explicit limits.
Next acceptance order: unify Calendar and Gmail readers through
Context Packs. Their established functionality is preserved; this release does
not claim their unified coverage is complete. Private GitHub,
multiple-repository and departmental Context policies remain pending. Action
Gateway, write connectors and general worker dispatch are separate phases.
