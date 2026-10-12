# Coding worker execution isolation v1

Scope: an execution foundation for host-packaged Node.js work orders, plus the
existing Owner workbench duration work order. Generic issue selection from chat,
arbitrary repositories, dependency installation, other languages and automatic
adoption are not connected by this chapter. Production Aroma is never mounted.

The executor uses Microsoft's Windows Sandbox OS isolation, with networking,
vGPU, audio, video, printers and clipboard disabled and ProtectedClient enabled.
It requires the installed feature, an active hypervisor and supported `wsb.exe`
CLI. Feature installation required a computer restart; first launch then installed
Microsoft's Store-updated Sandbox 0.8.107.0. The machine-wide CBS pending-reboot
flag can remain set by other servicing work, so that flag alone is not proof this
feature is unavailable. Missing hypervisor/CLI and failed boundary probes still
refuse execution. No registry flags are changed or cleared.
There is no fallback to host execution, the old command/exec sandbox or paid APIs.

Three per-execution directories are mapped: packaged inputs and a copied Node
runtime/host runner are read-only; only a dedicated result directory is writable.
No .env, auth, .git, node_modules, data, original repository or account directory
is shared. Up to 50 files / 1 MB are packaged, only named source files can change,
and host-selected test files remain immutable. Paths, commands, credentials,
models and sandbox configuration are not accepted from the browser.

Codex uses existing subscription authentication on the host, latest Sol
`gpt-6.1-sol`, medium. It returns bounded replacement file text, with shell/tools/
MCP disabled by the existing text client. The host packages this text and only the
offline OS executes it. The existing account/credits controls remain authoritative.
No API fallback, credit purchase, automatic retry or autonomous application occurs.
Sealed work orders reuse OwnerApprovalStore's one-use nonce, content hash, session
and ten-minute expiration. Restart invalidates pending authorizations.

Every VM first measures absence of external network interfaces, clean guest
identity/environment, denied host sentinel read/write, denied write to inputs and
tools, IPv4/IPv6 loopback connection denial and Internet TCP denial. Source/tool/
configuration hashes are checked by the host before launch and after execution.
Only after passing these probes may supplied code run. Node permissions are an
additional guard, not the OS security boundary. Child test processes remain inside
the disposable VM. The independent test reporter separates child stdout from its
own statistics. Evidence binds job ID, input hashes, test cardinality and exit code.
Test output remains guest output requiring Owner review, not a cryptographic proof
of program correctness or a release authorization.

Baseline and candidate execute in fresh VMs. The result includes actual tests,
before/after file contents/hashes, patch hash and timestamps. Each VM has 4 GB
configured memory and bounded execution time. Output size/names are polled and
validated; this is best-effort monitoring, not a Windows disk quota guarantee.
No guest source is executed or imported by the host during result validation.

Only the randomly minted owned VM ID may be stopped. A durable lease is retained
when stop cannot be confirmed; another executor/bridge restart remains blocked.
Explicit recovery checks the owned job's directory and record before stopping
that ID, and never resumes code/model execution. Artifacts and terminal failure
evidence remain available; no generic sandbox sweeper deletes these workspaces.

Actual OS acceptance, 2026-10-03: baseline and candidate ran in separate offline
VMs. All ten boundary probes passed. The host-reviewed second work order's seven
tests changed from one pass/six failures to seven passes with latest Sol through
the existing subscription, run `6af1a360-64d5-4d8b-a280-c007a76a9e07`.
Patch SHA-256: `898ff4729553b38493f0785010e224e206a221115ed6357f6109775416d3a72e`.
The fixture is an independent acceptance example, not a production Aroma repair.

Actual cancellation stopped owned VM `79485ea4-cd6f-41d4-ad7c-b594339f624b`.
After deliberately terminating the owned execution process, a fresh executor
remained blocked by its durable lease; explicit owned recovery stopped VM
`4d13e82e-904f-4f38-a752-e43ec98b5d07` without resuming code/model work.
No owned VM remained. Artifacts and original source/test hashes were retained.
Proofs in the development workspace: `outputs/worker-sandbox-os-probe.json`,
`outputs/worker-isolation-post-reboot-coding.json`, and
`outputs/worker-sandbox-recovery-acceptance.json`.

The architecture marks this packaged Node.js execution foundation connected;
arbitrary project integration and automatic adoption remain unconnected. Actual
boundary probes must pass again for every future execution. Unit mocks, a queued
job or installation alone are never sufficient acceptance evidence.

Official OS references:
- https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file
- https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli
- https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install

Memory final acceptance stays Owner-paused and unchanged. This chapter does not
read/send email, alter production business data, buy credits or push remote Git.
