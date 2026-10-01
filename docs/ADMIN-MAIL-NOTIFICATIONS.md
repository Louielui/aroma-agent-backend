# Administrative mail notifications and analysis

The local backend uses Gmail Watch and an outbound Pub/Sub pull subscription.
Port 8090 stays loopback-only. Receiving a notification does not run a model:
history changes are read and source-bound snapshots are committed first. Only
then is the delivery acknowledged. The existing five-minute, initial-30-day
mail scan remains available independently of notification setup.

## Connection and authority

The Owner authorizes Pub/Sub separately at the mail-memory page. This does not
replace the administrative mailbox's Gmail read-only credential. The OAuth
client's project determines the destination; no user-supplied project or URL is
accepted. PKCE, nonce, verified Owner email/domain, expiring state, browser cookie
and disconnect epoch protect consent. The refresh grant inherits the existing
private admin-mail-secrets directory ACL, outside the operational database.

Setup creates `xiangxiang-admin-mail` and `xiangxiang-admin-mail-local`, preserves
existing topic IAM (including etag and version 3 conditions), and adds only
`gmail-api-push@system.gserviceaccount.com` as topic publisher. The Owner identity
needs permission to manage those resources, and the Pub/Sub API must be enabled.
The app does not enable billing, change organization IAM, or expose a webhook.
Google Cloud usage can be billable. Disconnect removes the local grant; it does
not delete the cloud resources or revoke Google's account-level grant.

## Delivery and recovery

The receiver renews Watch daily, independently of analysis. Decimal history IDs
are compared with BigInt. Pagination keeps the original cursor until the final
page. Failed capture leaves the event unacknowledged. Duplicate delivery reuses
deterministic message/thread IDs. Malformed and foreign-mailbox notifications are
discarded and counted. Excluded, undecodable, deleted or capacity-limited mail is
counted as excluded; it is not represented as a complete retained snapshot.

Discard counters distinguish malformed payloads, wrong mailboxes and invalid
history cursors without retaining notification bodies. Safe integer JSON cursors
are normalized to decimal strings; unsafe numbers are rejected. Explicit receiver
retry renews Watch to request Google's initial notification without resetting the
saved history cursor. A Watch alone is not proof of valid notification receipt.

Five-minute history reconciliation covers lost notifications. Expired cursors
trigger a checkpointed full-mail scan, then replay from its pre-scan baseline.
If that baseline expires again, recovery restarts. This recovery mechanism does
not imply an initial full-history import has been performed. Notification
delivery requires the computer and service running; it is not an instant SLA.

## Analysis scheduling

The background scheduler is independent of ingestion. It persists pause, mode,
attempt budget and retry time. Catch-up permits up to 120 attempts per hour;
balanced permits 30. Processing is serial. Approved threads requiring review
come first, then newest messages; every fifth attempt gives the oldest remaining
thread a slot. An idle queue is checked again after a minute. Subscription limit
or login errors back off for an hour; other failures back off exponentially.
Explicit retry resets the delay, not the hourly attempt count.

Incoming authenticated conversation intake cancels the background HTTP request
and waits for its settlement. The subscription bridge already aborts its model
turn when that client disconnects. Scheduling waits for the conversation to end
and a sixty-second idle period. This protects the chat intake path; other model
clients still share subscription capacity and may receive bridge-busy errors.
There is no paid API fallback. Manual per-thread analysis remains available.

## Acceptance and remaining work

Unit/HTTP tests use injected Google, model and store fakes, including lost source
access, pause during pull, failed persistence, expired cursors, pagination, large
IDs, OAuth identity/nonce rejection, IAM preservation, source-bound thread
priority and model cancellation. Live acceptance must separately verify the
boot commit, UI status, a real authorized Watch, notification timestamp and
captured new message. The API, topic, pull subscription and Watch were confirmed
live. The Owner test message at 2026-10-01T02:55:14Z produced a valid notification
at 02:55:30.712Z, a persisted source at 02:55:32.591Z and analysis at
02:56:07.532Z. This measured delivery took about 19 seconds to save and 54 seconds
to classify. Earlier discarded notifications predate reason counters; their
cause remains unknown. No automatic email sending or task execution is
introduced. Resumable full-history coverage and dedicated Hindsight mail recall
are implemented in the 2026-10-01 release and still require deployed acceptance;
see `MEMORY-OWNER-V1-ACCEPTANCE.md`. Ivy mail memory and attachments remain
unconnected.

References: [Gmail push](https://developers.google.com/workspace/gmail/api/guides/push),
[history](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list),
[Pub/Sub pull](https://docs.cloud.google.com/pubsub/docs/reference/rest/v1/projects.subscriptions/pull).
