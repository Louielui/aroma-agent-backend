# Main system client updates V1

The main chat header offers Update. It checks the existing authenticated,
same-origin version endpoint and reloads the already deployed document. It cannot
merge, deploy, restart a service, install an extension or grant a source permission.
The document route already revalidates its cached response. No new endpoint,
dependency, connector or model setting is introduced.

The explicit click places a closed, at most 20,000-character text draft, exact
conversation ID, stored flag, home/conversation view, exact path/query scope and a
one-minute expiry in the current browser history entry. No draft travels in the
URL or a request. This is a temporary browser-history handoff, which the browser
may retain while pending; it is not a claim of disk-free memory. Other history
state remains intact. Successful restoration consumes only the handoff. Invalid,
expired, foreign-scope and extra-field records are discarded, never instructions.
No model output, consent, attachment, task permission or executable action is
stored in the handoff.

Saved transcripts remain in the existing Owner-authenticated server store. The
same authorized conversation listing and transcript read must succeed before its
draft can be sent. A missing transcript or conversation keeps the draft visible
and blocks sending until the Owner explicitly selects a conversation. A failed
history write or version check keeps the current page and draft. No saved task or
draft is submitted automatically. History restoration reads existing job status;
it does not authorize or restart execution.

Active replies, model-selection saves, unresolved local replies, prepared images,
open dialogs, operation/confirmation controls and open department tools block
update. Local turns are marked unsaved until the server explicitly acknowledges
their persistence. A later saved turn cannot erase an earlier unsaved-turn marker;
the Owner is told why reload is blocked. Attached report modes must be finished first. Home and plain empty chat
are supported. Other standalone tool pages keep their existing controls. The
first installation requires one ordinary main-page refresh; later deployments
can be loaded with the header button without closing Chrome or its installed app.

Offline acceptance loads the actual assembled page in an isolated browser and
changes its served version. It verifies fresh assets, same conversation/draft,
literal hostile text, preservation of unrelated history state, zero auto-send,
version/history failures, missing history, expiry/scope/extra-field refusal,
attachments, Home, current replies and confirmation controls. These fixtures do
not read company sources. Deployment and real main-window validation are separate
measured acceptance steps.
