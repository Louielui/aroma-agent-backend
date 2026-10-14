# Visible browser work status v1

The side panel previously awaited one long native reply with a footer sentence.
Task-only requests also incorrectly said that the page was being checked. A
measured task-only job completed in about sixteen seconds with no page snapshot
or business-read evidence; waiting for its answer was not email search activity.

The new card stays above the composer, outside the scrolling conversation.
It shows a fixed, allow-listed current phase, elapsed processing time and the
existing Stop control. Model request start/return events are host-measured and
durable; registered source-read phases use their existing events. A timer shows
elapsed time, not estimated completion or a percentage. No model reasoning text
is exposed. Completed, stopped, failed, interrupted and unconfirmed work stops
the animation and clock. Older records without a valid start time do not gain
an invented duration. Reduced-motion preference disables the animation.

During a read the panel observes the same saved job through its existing get
operation, with one pending status request, a one-second minimum interval and
a 130-second observation budget. Polling does not dispatch a model, source read
or native input. A durable terminal answer can resolve the UI even if its
original read reply is delayed. Recovery observes a processing job through get
only; it never repeats read or consent. Three consecutive lost status replies
expose uncertainty and stop the spinner instead of claiming ongoing progress.
The existing recovery control can observe that same job again.

An activity epoch rejects late replies after stop, a new question or a topic
reset. Stopping preparation invalidates its capture and cancels a late orphan
approval; no model was dispatched. Stopping after dispatch uses the existing
cancel route and clearly retains the possibility of subscription consumption.
The backend refuses to save a model-return event or answer after cancellation.
The native-operation panel shares the visual card and existing Stop path;
it reports general operation processing rather than inventing a mouse action
while awaiting a response. Its admission, actions, bounded profiles and
unfinished-operation non-replay policy are unchanged.

Tests use held model/source/reply gates, a separate unchanged baseline and real
headless Edge. They cover visibility in a long narrow conversation, elapsed
time, host phase changes, stop during preparation and inference, delayed
replies, status loss, get-only restoration, independent topics and unchanged
consent. Synthetic gates are identified as fixtures, not business acceptance.

Delivery requires the reviewed Chrome UI assets to replace the exact known
installed UI bytes after preserving their originals, then an extension reload
and measured live acceptance. Preserve the original installation receipt,
native host registry, manifest, five Chrome permissions and rollback files.
This feature adds no Gmail read, deletion, new website operation, permission,
credential, model change or production database access.
