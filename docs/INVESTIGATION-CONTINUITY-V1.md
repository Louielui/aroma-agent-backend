# Investigation continuity v1

This chapter extends read-only investigation, not the action gateway.

The authenticated chat route reads only the last saved assistant turn in the
specified conversation and follows its server-owned investigation receipt ID.
Browser history cannot supply that pointer. Missing, unreadable, failed or
cross-conversation receipts are not usable references. An intervening ordinary
chat turn prevents silently reaching back to an older investigation.

The existing goal-planning call chooses `investigation_reference: previous` or
null by meaning. The reference is separately labelled historical context, grants
no source permission and cannot fulfil current evidence obligations. A fresh
authorized operational read is still required. No extra model call, retry,
translation API or provider fallback was introduced. Long working-context turns
retain their beginning and end within the existing 300-character bound; the
omitted middle is marked.

Only matching record IDs in readable source sections can yield field comparisons
for state, model and reason. Unknown fields, duplicate identities, unreadable
sources, sample omissions and changed topics remain explicit gaps. A follow-up
about a failure keeps the previous selected task even when a newer failure exists.
A completed state or a changed field does not prove a repair in the loaded version.

Chinese, English and mixed-script failure/background summaries use the same
source-bound bilingual presentation. The model selects goals and operations;
the server renders the observed fields and fixed uncertainty text. General
free-form semantic entailment, arbitrary investigations, whole-account live job
inventory and vendor billing proof are not completed by this chapter. Existing
legacy prose-name checks remain intact. No schedule or external system is changed.

Acceptance covers fresh multi-turn questions, saved receipt reference values,
read provenance, language, screen visibility, reload/idempotent replay and actual
service restart. The architecture entry stays partial until broader sources and
semantic evaluation have been measured.
