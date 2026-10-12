# Controlled dispatch v1

Owner chat now has two explicit, closed work entrances. `routeWorkRequest` maps
development-progress proposals to `DevelopmentProposal@1`, and code diagnosis to
`CodeDiagnosis@1`. Quoted, negated, compound or unknown requests do not authorize
either workflow. Existing business/Live Context entrances continue unchanged.

## Code diagnosis

Open `/development-plan` → **程式診斷與派工**, or ask:

> 香香，檢查自己目前的程式，提出問題證據和修正方案。

The host supplies eight fixed committed dispatch source/test blobs from the local
Xiangxiang backend. `contract.js` owns this profile; callers cannot supply project
paths, prompts, credentials, tools, commands, worker identities or approval flags.
The reader runs in the existing authenticated, loopback-only Owner bridge. The
Windows LocalService backend sends only its boot commit to the closed
`/code-diagnosis-source` route; no caller-supplied path or command is accepted.
The backend enforces its live `READ_ACCESS` flag before and after requests. The
bridge host grants only this fixed Owner reader, independently of launcher-only
service flags; neither browser requests nor bridge JSON can override permissions.
This preserves normal Git ownership/trust checks instead of weakening Git or
Windows service protection. Source reads never call a model. The reader pins
Git HEAD, checks the repository root, bounds each blob and the
whole packet, rejects recognizable credential content, and rechecks HEAD. Working
tree changes, .env, logs, operational data and the production restaurant repository
are outside this profile. Committed-only scope is explicit in every result.

The existing Capability Registry, agent registry/health ranking, policy and
Dispatcher are used. Policy is evaluated before subscription checks or context
reads. Only host-composed adapters implementing the exact `CodeDiagnosis@1`
contract are eligible. New dispatcher constructor options bound candidate agent
IDs and disable automatic fallback without changing other callers' defaults.
Unexpected globally advertised agents cannot gain access to this workflow.

The initial adapter is Codex subscription text using `gpt-6.1-sol`, medium
reasoning and the existing account/credit/spend controls. It has no shell, file,
MCP, app, plugin or delegation tools. The provider checks the exact actual model
and billing transport. No API fallback, purchase, automatic retry or account-cap
change is introduced. Chat model selection does not change this worker role.

The host provides numbered source lines. Structured results contain up to five
hypotheses, exact evidence IDs, bounded line ranges and original quotes, proposed
fixes, validation plans and limitations. Zero findings is valid. The host validates
shape and quoted original lines, then rereads all source blobs and compares the
revision, boot revision and packet hash. Changed evidence withholds the result.
Matched quotations do not establish that a defect was reproduced: the UI says
findings remain unverified and that tests/edits were not executed.

## Lifecycle and persistence

Runs use the existing atomic run store under `code-diagnosis-runs`, workflow
`code_diagnosis`. Receipt, policy, actual worker choice, model, source hashes,
dispatch milestones, source checks, cancellation, timeout and terminal status are
retained. Source blobs and proposals stay in Owner-only run records. The ordinary
conversation record retains the work link; accepted HTTP work is not completion.
Only a compact measured terminal receipt is submitted to Owner episodic memory;
`queued` is not claimed as saved/indexed memory or a verified decision.

Persisted request IDs suppress duplicate calls even after reconstruction. Restart
marks active work interrupted and does not replay it. Cancellation/timeout abort
the provider and discard late results, including uncooperative responses. Audit
failure prevents subsequent work. Opening pages, reading status or refreshing a
completed report never starts a model turn. All write entrances require Owner
authentication, loopback origin and exact request shapes.

## Extension boundary

Future accepted host adapters can implement the same contract and participate in
existing health-based selection. Tests cover two composed workers and show that a
failed selected worker is not silently replaced. This proves the extension
boundary, not a live Claude connection. Claude diagnosis/review, general arbitrary
task routing, other repositories, multi-step planning, test execution, patch
application and Browser/Computer execution remain unconnected for this workflow.
They require explicit contracts, bounded source readers and actual acceptance.

The fixture coding/review workbench and existing development-metadata proposal
remain separate accepted recipes. No parallel generic registry/dispatcher is added.
