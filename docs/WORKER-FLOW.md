# Subscription worker flow: architecture 06 / 07 / 08

The owner-facing `/workers` page links from `/architecture`. The backend authenticates
the owner and enforces same-origin POST requests. It forwards fixed operations to the
authenticated loopback subscription bridge running in the signed-in user's session.

The first recipe, `duration-v1`, approves one disposable fixture. Codex reads the source
and immutable tests, writes only `duration.js`, and requests the fixed test command.
Xiangxiang independently reruns all five tests and sends the work order, before/after
source, and measured results to Claude for structured review. Both passing tests and
a passing review are required for completion. No change is applied to a real project.

## Execution boundary

- Codex native shell, file tools, MCP, apps, plugins and delegation remain disabled.
  Three host tools enforce exact filenames and arguments: read_file, write_file, run_tests.
- Fixed commands run with Node permissions (read only the fixture; no writes, child
  processes, addons or workers) inside the Windows network-disabled permission profile.
  A non-secret outside-file read/write probe must fail before any model turn starts.
  Windows sandbox filesystem read restrictions alone were insufficient in live testing;
  the bounded host tools and Node permission layer are required, not optional.
- Claude uses the existing signed-in subscription, restricted mode, no tools or MCP,
  no hooks and no persisted session. Only the supplied fixture packet is reviewed.
- Neither provider falls back to a paid API. CLI usage estimates are recorded as
  estimates; actual account charges remain unknown. Account extra usage settings apply.
- Durable events record approval, boundaries, tool calls, tests, review and failures.
  Process restart interrupts incomplete work. No automatic retry occurs. An explicit
  review retry uses the existing source/test evidence and does not repeat coding.

## Configuration and operation

Set `XIANGXIANG_WORKER_FLOW=on` in the backend `.env` to enable this recipe, and set
`XIANGXIANG_WORKER_WORKSPACE_ROOT` to the verified absolute fixture root. The existing
execution authorization matrix blocks conflicts with develop, agent and computer modes.
The bridge uses its existing CODEX_CHAT_EXECUTABLE and bearer token; no new credentials.

Records live at `%LOCALAPPDATA%/AromaXiangXiang/worker-flow/runs`. The UI displays the
latest ten records without deleting older ones. GET/history never starts a model turn.
Readiness checks inspect account state; execution evidence is a separate run record.
To disable new runs, set the flag to `off` and restart the user-session bridge. Preserve
records for audit. Revert this feature's commit and restart the backend for code rollback.

## Live acceptance, 2026-09-29

Run `eababcc0-d8d6-47b6-ac53-e4a4af946dc3` used the final bounded host tools: outside
read/write denied, baseline 5 failures, final 5 passes / 0 failures / 0 skips, Claude
verdict pass with no findings. Codex reported `gpt-6-astra`; Claude's reported model usage
included `claude-sonnet-5` and `claude-haiku-4-5-20251001`. Earlier failed trials remain
visible and are not presented as successful acceptance.

General repository dispatch, applying patches to live code, Browser/Computer workers,
and general architecture/review tasks remain unconnected. Each needs a separately
defined work scope and acceptance criteria before enabling it.
