# Delegation evidence read projection

This is a candidate change, not evidence of deployment or successful Worker dispatch.

## Problem and scope

The retained PR160 question asked which AI workers Xiangxiang could delegate to.
The goal output correctly restated that request, but its required f2 fact had no
mapped operation. The host correctly retained `no_operation_in_this_system_carries_this`.
The available work section held only workflow defaults and occupancy; it could not
establish the worker roster, connection and job authorization.

This change projects existing declarations and metadata through the existing read
layer. It does not create a new registry, Dispatcher, approval store or grant.
The legacy seven-role org chart remains unchanged. The typed capability-agent
registry, backend diagnosis/proposal/planning services and Bridge workflow providers
remain their respective authorities. Their identities are namespaced by component.

## Source path

1. The existing agent manifests receive read-only descriptors from the same provider
   instances/defaults used by the composed services. A detached manifest snapshot
   exposes no registration or execution method.
2. The existing authenticated loopback Bridge adds a closed empty-input
   `/delegation-metadata` read. It reads provider descriptions, current workflow
   enablement, registered recipes and the existing subscription model catalogue.
   No completion, Sandbox readiness execution, approval refresh or workflow start
   is reachable from this handler. It remains readable while a workflow is occupied.
3. The existing `xiangxiang_operations` adapter provides an explicitly selected
   `delegation` section. Ordinary/default investigations do not request it and
   therefore incur no additional catalogue preflight. Existing source/read flags
   still gate the read; the model cannot provide paths, commands or credentials.
4. The existing goal schema can select `delegation` evidence. Source descriptions
   now name that actual read capability. The lean capability view retains this
   bounded receipt without loading historical job bodies or another classifier.
5. The existing answer renderer binds its main model list directly to the fresh
   live section before applying the unchanged final route/evidence guard. Its
   receipt identifies the source and records `modelProseUsed:false` and
   `dispatchVerified:false`. The original model output remains in details/evidence.

## Truth boundaries

- Registration, lane enablement, catalogue availability, transport observation,
  job approval, budget and actual acceptance remain separate fields.
- `canAccept` stays null. `authorization` is `required_per_job`; budget is
  `not_evaluated`. Metadata never consumes, renews or supplies an approval.
- Provider catalogue login/unavailability diagnostics are preserved when known;
  missing quota evidence is not called exhaustion. Catalogue entries are selectable
  models, not independent workers, and do not expand any execution allowlist.
- The task planner default is distinct from its per-request model selection.
  CLI review's `sonnet` alias resolves only from the observed catalogue; its unset
  effort is not falsely labelled Medium.
- Backend and Bridge snapshots must share the expected boot commit, be at most
  60 seconds old and no more than five seconds in the future. Missing, ambiguous,
  malformed or foreign-version components remain unavailable while the other
  component's known declarations survive.
- All named channels and model choices remain in details. Legacy roles, background
  schedules, local adoption and the central brain do not become additional workers.
- Previously saved null-operation plans remain explicit gaps. Offline tests use a
  labelled updated catalogue selection to exercise the new path; they do not alter
  the historical output or claim the real model has already chosen the new schema.

## Validation and delivery gates

Tests reuse retained PR160 goal/final output and sanitized audit metadata, with
explicitly labelled candidate-schema projections. They exercise host rendering,
the full intake path, catalogue logout, stale/foreign snapshots, ambiguous IDs,
untrusted source substitution, read-only Bridge authentication and occupied-lane
behavior. They assert no additional intake helper step or workflow/Sandbox start.
The HTTP enquiry regression now reads a disposable committed Git fixture instead
of the developer checkout. It still uses the real revision producer and additionally
proves that an uncommitted source edit is refused before sealing or dispatch. The
translation resolver remains confined to presentation; the new source projection
does not import it.

The architecture inventory remains partial/native-acceptance pending. Full isolated
tests and exact-commit independent review are required before a held deployment
package. All eight paused acceptance ledgers, protected configuration, original
automatic-memory setting and the launcher overlay remain unchanged. This tranche
does not create an acceptance root, append quota, dispatch a Worker, merge or deploy.
Deployment and a fresh bounded real acceptance require separate Owner decisions.
