# Current-source project work orders v1

Owner uses `/workers` → `/project-work` to prepare, inspect and approve a sealed
work order. The host binds only its own backend root. The truth project registry
does not grant execution authority; Aroma System has no execution adapter here.

The first registered work order captures the current committed
`src/context/contextResult.js`. Its object fields currently share source references,
so later caller mutations change a previous context read. Eight host-reviewed tests
exercise deep snapshot independence, arrays, separate reads, source preservation,
metadata and honest unavailable results. This uses real committed bytes, with no
synthetic corruption. Only that source file is editable. Tests are protected.

Prepare binds commit, running boot commit, blob and SHA-256, acceptance hashes,
goal and file scope to a one-use Owner nonce with a ten-minute lifetime. Browser
input cannot choose paths, source text, commands, credentials or models. Dirty
affected source, reparse paths, replaced Git objects, runtime drift and source
changes fail closed. Unrelated local changes are neither packaged nor modified.
Source checks repeat before and after both VMs and before final completion.

The shared Windows Sandbox executor measures the baseline and candidate in fresh
offline VMs. Codex latest Sol returns text replacements via the existing subscription;
no model-generated code runs on the host. Claude only reviews a text packet, with
tools, hooks and MCP disabled. Test counts and isolation probes are measured;
model review is an opinion, not proof of correctness. No API fallback, automatic
retry, adoption, production write or remote push exists on this route.

Atomic private Owner run history retains source evidence, approval hash, stages,
before/after contents and hashes, tests, patch hash and review. Stage receipts go
to the existing memory outbox; queuing is not Hindsight indexing. Restart invalidates
unconsumed approvals and marks active work interrupted; it never resumes execution.
Cancellation uses the owned executor's stop and recovery protocol.

This is a bounded backend profile, not arbitrary project/dependency/language support.
General chat dispatch remains unconnected. Independently approved local adoption is
connected for the registered scope; see PROJECT-ADOPTION-V1.md and PROJECT-MULTIFILE-V2.md.
