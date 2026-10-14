# Browser Context-Aware Intent Routing V1

Owner-approved implementation and offline verification only, 2026-10-14.
This candidate has not been deployed or accepted against company data.

## Executable path

New side-panel topics default to automatic context. The existing isolated collector
attempts to capture the topic's own active tab using its existing Toolbar Grant.
No grant is requested or synthesized. Missing authorized capture is shown as
unavailable. Explicit page/selection and no-page controls remain available.
Preparation calls no model or company reader. The confirmation shows the actual
page, provider, history, and frozen task capability scopes before model egress.

`intentRouting` supplies a versioned Context -> Intent -> Source contract. V1
admits Browser evidence only, tagged untrusted data with observed origin, time,
coverage and a server-derived Drive locator. Owner words determine authority.
The intent model sees context but not tool availability; registered availability
is applied by the host afterwards. Explicit general requests override an internal
page. Ambiguity/unavailable context remains visible rather than inventing access.

`contextTask` wraps the existing wage task. Existing task versions keep their
original path and tool set. V2 may disclose the existing registered Aroma Base
scope with only metadata verification/search/get operations. No other source is activated. The Drive
scope includes a hash of the existing Owner grant, source and credential-file
revision projection; it never contains credential values. Scope equality and
provider-sharing checks run before/after model and source steps, alongside the
existing source lease. A changed scope requires a new preparation/confirmation.
A permission hash binds the task ID, Owner question, protocol version, context identity and disclosed tool set; it is rechecked before dispatch. Old pending jobs and old follow-up chains cannot inherit V2 permissions.

Drive execution reuses `liveContext.drive.read`, Drive Context, ToolGateway and
its original audit. Search queries must consist of terms present in the direct
Owner request. Current subfolder/file locators are verified using the scoped metadata reader
before a whole-Aroma-Base search; a browser URL never establishes Drive authority.
At most 25 search candidates and three candidate bodies are examined. File IDs
must come from the current API search. Only actual text-projection bodies enter
excerpt selection. Each displayed quote must exactly match a retrieved body.
Metadata-only files, partial search, truncated documents and unsupported formats
remain explicit and cannot become verified complete recipes or absent records.

## Boundaries and compatibility

- Chrome permissions, stable extension ID, Native Host and Action Gateway are unchanged.
- AISL writes/execution paths are not reachable through this read facade.
- Page text, metadata and document bodies cannot authorize reads or execute commands.
- The existing provider-sharing restriction applies to Drive advertisement and dispatch.
- Audit failures prevent source transport; late results after cancellation are discarded.
- Active-tab changes, attachment/removal and navigation cancel contextual in-flight reads.
- Restart marks unfinished jobs interrupted; get/restore never replays models or reads.
- The main Browser work projection reads the same saved results; no new execution store.

## Offline evidence and limitations

Tests include a headless Edge panel with the real Drive Context/Gateway and an
injected synthetic reader. Baseline assets reproduce the old non-automatic
default. These fixtures establish software behavior, not live OAuth validity,
Toolbar Grant availability, real model intent quality or company recipe discovery.

V1 supports Chrome Browser evidence plus the already authorized Aroma Base tools.
Other environment providers and browser engines are not connected. Search is
bounded to the authorized shared drive, not recursively scoped to the displayed
subfolder. Queries are restricted to Owner-provided terms; aliases/translation
require Owner clarification. Google Docs/plain UTF-8 projections remain bounded
by the existing 16,000-byte reader; PDF, images, Sheets, document tabs/comments
and layout are not verified. Answers use source-matched excerpts, not unconstrained
generated internal recipes. Remaining live testing and deployment require a
separate Owner approval, independent exact-source review and normal policy gates.

## Controlled acceptance follow-up candidate

The PR #94 controlled test recovered subscription authentication but an implicit
recipe lookup in Drive still produced clarification without a source read. An
explicit-source control reached search and get, but selected an unsupported file
and a folder, yielding metadata only. No recipe body was verified.

This isolated follow-up explains file-workspace artifact lookup to the intent
planner without forcing every open tab to be relevant. General, unrelated,
negative and untrusted page requests remain distinct. The selector now receives
the existing source MIME type and text-read support, prefers relevant readable
documents, and cannot select folders. Unsupported matches remain metadata-only,
with source names, links and readable limitations instead of an empty generic
result. Existing 25-candidate/three-file bounds, formats, task version 2 and
tool-scope version 1 are preserved. No PDF, image, Sheet or folder-list reader is
added. Synthetic real-model evaluations are separate from company-data acceptance.
This follow-up candidate is not deployed; PR #94 remains the running baseline.
