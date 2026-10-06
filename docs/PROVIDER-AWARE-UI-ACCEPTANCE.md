# Provider-aware UI acceptance

Fresh chat and sidebar work orders use `edge-headless-offline-v2` browser
evidence. The immutable helper exercises the complete assembled page in offline
Edge: Claude initial selection, Medium where supported, company-specific model
menus, catalogue-driven effort lists, Haiku automatic effort, and unavailable
catalogue handling. Its synthetic catalogue is an interaction fixture, not live
account availability. All requests remain intercepted; these checks call no model.

Version 1 evidence remains readable under its original schema. It is never
relabeled as version 2 or rewritten. New protected test drafts no longer require
GPT as the initial selection or exactly five levels for every model.

The targeted result page offers original/candidate screenshot controls when
original browser evidence exists. `phase=before` selects the baseline receipt;
the default selects the candidate. Both use the existing Owner-protected read
path and verify the saved evidence and image hashes. Missing or altered baseline
evidence fails closed, without substituting a candidate or current live screen.
Viewing and comparing images cannot dispatch work or approve adoption.

Planning and task source readers tolerate unchanged Windows CRLF/stat differences
without refreshing the host index. A sole unstaged `M` status is checked against
the real raw Git diff with explicit Windows normalization; the committed blob and
actual file must still match exactly after CRLF-to-LF normalization. Staged changes,
unknown status shapes, mode changes, real byte changes and source revision drift
remain rejected. The regression tests reproduce the false `source_dirty` rejection
in a temporary repository and also reject actual edits and staged content even
when the working file is restored. The first live failed attempt is retained;
this fix does not rewrite or automatically retry it.

The authenticated empty-shape `/models` bridge route is read-only account
metadata. It uses a separate bounded subscription session and coalesces concurrent
reads, without acquiring or releasing the execution lane. Catalogue reads remain
available while task/status requests or workers are active; chat and execution
requests still retain their existing overlap guards. The metadata reader starts
no inference turn, exposes no credentials, and does not cache failed availability
as a permanent account state. Other bridge routes keep their original policy.

This does not expand editable profiles, allow external browser access, change
chat/model defaults or credit policy, or grant automatic live application.
