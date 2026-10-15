# Browser client updates V1

The Chrome side panel has an explicit Update button. It saves the current draft
and reloads a verified, already deployed local client. It never merges a PR,
downloads code, invokes a model, restarts a service, or grants source access.

The installer opt-in `-PublishClient` places reviewed extension assets in
`%USERPROFILE%/.imagine/browser-client/extension`. Chrome loads this stable path
once. Immutable release packages and prior slot directories remain available;
unaccounted edits, symbolic links, foreign packages and additional Chrome
permissions refuse publication. A failed native registration restores its prior
registration and the previous slot. No rollback directory is deleted.

After the Owner opts in, ordinary gated local runtime verification publishes the
client from the exact deployed Git commit using the reviewed installer. Publication
failure is not verified deployment. A rollback to a pre-update installer reports
`legacy_client_requires_explicit_restore`; retain the immutable prior package and
restore its native registration/Chrome path explicitly instead of guessing that
the managed slot is compatible. The first opt-in is a separately measured client
installation after Backend and Bridge verification.

The deployment installer pin accepts Git's CRLF checkout expansion by comparing
the LF-normalized bytes. All other bytes remain exact: code, spaces, BOMs and
trailing-newline changes still fail. This changes no install command or permission.

Native client status is one closed metadata operation. It checks the Backend boot
commit, active browser jobs, current slot pins and the unchanged five permissions.
The endpoint requires the existing service token and refuses browser origins.
It reveals no questions, answers, document contents or credentials. Only the own
scoped side panel can request an update; arbitrary paths and commands are rejected.

Update refuses active or uncertain work, unconsumed consent, unknown installation
state and failed draft persistence. It never dispatches another read or reuses
consent. An unchanged manifest and worker bundle allows the panel to reload in place. A changed
worker bundle requires `chrome.runtime.reload()`; Chrome may close the side panel,
in which case clicking the existing toolbar icon restores it. Chrome itself does
not need restarting. A fresh Toolbar Grant remains necessary if Chrome cleared
page access. No button can manufacture that grant.

Tab-topic bindings migrate from session storage to local storage so an approved
extension reload can retain the same topic through a short-lived own-worker
handoff. A session sentinel is checked on each worker wake. Pending clears survive
worker replacement and are retried; a missing sentinel fails closed into clearing.
A genuine browser startup clears only the tab
bindings, not saved topic records, avoiding reuse of old browser tab identifiers.
Completed jobs are recovered with status reads only. Pending jobs are not replayed.
First installation can recover a unique legacy saved read topic using content-free
host task/tab/window bindings and a saved URL hash matched to live permitted tab
metadata. Recovery runs separately when each tab requests its own context and its
URL is readable through its existing grant; opening one panel does not mark other
tabs as migrated. The URL is checked again after the metadata reply. Migration
does not require installation/occupancy readiness and degrades
to a fresh topic when binding evidence is unavailable. No capture or broader grant
is requested. Ambiguous topics, task-only/operator legacy records
with no source binding, and draft-only legacy records are retained in local storage
but are not guessed into a tab. Future updates retain their new durable bindings.

Offline checks cover actual new asset loading, draft/result restoration, blocked
work and storage failures, metadata-only native status, scoped sender rejection,
extension reload versus browser startup, preserved previous bytes and permission
or local-edit refusal. Live Chrome installation and button verification are a
separate acceptance stage; offline fixtures do not attest to them.
