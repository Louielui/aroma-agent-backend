# Owner-session memory runtime reliability

On 2026-10-01, the backend was serving its boot identity on 8090 while the Owner
bridge on 8091 and Hindsight on 8888 were absent. Canonical memory reads failed.
The existing Startup shortcuts launched PowerShell files, and native PowerShell
reported its default Restricted policy. The memory shortcut supplied no policy
option. Starting the existing Node entries as the Owner restored the dependencies.
This is availability evidence, not proof of data loss or a recall quality failure.

`scripts/memory/installAutostart.cjs` repairs only the two existing Owner Startup
shortcuts. They target the installed Node executable and `serviceSupervisor.cjs`
directly, independently of PowerShell script execution policy. Normal user rights
suffice. The installer verifies each old identity, backs up changed shortcuts,
reads back the new target and arguments, and reports an existing Windows-disabled
Startup state. It does not re-enable a user-disabled entry, change machine policy,
install a privileged service, or alter any other Startup item.

After local deployment, run the installer as the Owner from the deployed checkout.
The supervisors can be launched under the Owner immediately without waiting for
the next login. The existing `.ps1` files remain compatibility entrypoints. Startup
shortcuts use the minimized window setting; child processes are hidden. This
continues to require the Owner's Windows session. The backend service's privileges
and the private database configuration ACLs remain unchanged.

Each component owns a user-local lease with a heartbeat. Concurrent invocations
cannot become duplicate supervisors; dead or stale leases can be recovered.
Recovery retries do not stop after three process exits: delays grow from ten
seconds to a maximum of sixty seconds, resetting after verified health. A startup
has a five-minute warmup allowance. Three later failed liveness measurements can
restart only the exact child process tree created by that supervisor. Healthy
pre-existing services and foreign listeners are never terminated or adopted for
restart. A crashed supervisor's surviving child can be observed by a later
supervisor; an unresponsive pre-existing process requires explicit intervention.

`src/memory/serviceHealth.js` performs only local read probes. Canonical database
health requires the authenticated closed bridge route and the exact separate
`xiangxiang_memory_core` identity. Hindsight requires its liveness signature,
database readiness and authenticated configured-bank statistics. No extraction,
recall, reflection or model call runs during these probes. Dependency readiness
failure is reported as degradation and does not cause a live process restart.
Errors are fixed reason codes; response bodies, credentials, bank content and
exception messages are never included in status. Probe time is explicit.

Sanitized supervisor status and leases live in the Owner's LocalAppData under
`AromaXiangXiang/memory-supervisors`. Backend component health should use fresh
probes rather than assuming this user-local file is readable by LocalService.

Acceptance must distinguish tested recovery from an actual Windows reboot/login.
Regression tests cover continued retries, serialized startup, liveness/readiness,
foreign identity, lease recovery and exact owned-process cleanup. Deployment also
requires live component health, installed shortcut readback, and observed recovery
after terminating only a verified owned child. A full Windows reboot/login remains
a separate acceptance event until observed. The canonical backup/restore and
source-bound mail permission requirements remain part of memory v1 acceptance.

## Reconstructing a lost general semantic index

The Owner can explicitly queue a complete general-memory index rebuild. The closed
`queue_index` store operation changes index metadata in one PostgreSQL transaction,
with source snapshots and hash-linked audit for every affected row. Its compact
request does not send the full historical corpus through the one-megabyte bridge
request limit. It includes only active, unexpired general records in the selected
scope; administrative mail, candidates, rejected, archived and superseded records
are excluded. It preserves source text and approval. Unsupported text lengths become
source-only without any model call.

Each eligible row retains the rebuild ID and queue time. The existing background
indexer resumes these pending rows after restart, reconciles matching originals
before extraction, and records saved, raw-only or bounded failed/retrying states.
The memory catalog reports the latest batch's actual outcomes. General lexical
source recall remains available while the semantic index is missing or rebuilding.
No live index must be wiped for acceptance; a separate test bank or injected engine
can prove reconstruction, then live indexing of an explicit acceptance source can
verify transport. Large-corpus throughput remains a separate measured limit.
# Live acceptance, 2026-10-01

On deployed commit `9460a99e65117d1fd8a9bf9d080f5f4f5880470f`, both known Startup shortcuts were repaired under the normal Owner account and their Node targets and arguments were independently read back. Neither entry was disabled. The supervisors first measured the existing healthy listeners without adopting or terminating them. After exact launcher identity and creation-time checks, the two previously authorized recovery roots were replaced by supervisor-owned runtimes.

A subsequent controlled process-tree failure of each owned runtime recovered automatically: bridge in 14 seconds and Hindsight in 22 seconds, measured by the next ready probe. Both retained the same supervisor PID, reported two starts, and cleared retry failures. A second instance of each supervisor exited successfully while the original instance retained its lease. Authenticated final probes at `2026-10-01T08:20:10.628Z` measured bridge, canonical PostgreSQL and Hindsight as ready. No backend restart, credential change, ACL change, data deletion or bank wipe was part of this dependency acceptance.

This proves service recovery in the current Owner session. An actual Windows reboot followed by Owner login has not yet been observed; the installed shortcut and disabled-state readback are startup configuration evidence, not a claim that a reboot acceptance has passed.
