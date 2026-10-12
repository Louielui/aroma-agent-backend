# Owner Calendar Live Context v1

Scope: the registered Owner's primary Google Calendar. The existing OAuth grant
is reused. Google must report calendar.readonly; writable calendar grants are
refused. The primary calendar ID must match the registered Owner. SDK, OAuth and
credentials stay in a fixed read-only client closure.

Tool Gateway exposes list/search/get/readMetadata. The local endpoint is Owner-gated
and same-origin. Inputs cannot select calendar IDs, URLs, credentials or SDK calls.
Credential/configuration changes are checked around reads and against a retained
access lease before cached chat delivery. Member and Ivy access remain unconnected.

Today uses America/Winnipeg midnight boundaries. This week runs Monday to Monday.
Each boundary is calculated separately across daylight saving transitions.
Google's overlap semantics apply: timeMin filters event ends and timeMax filters
event starts. Events are not a projection of all company deadlines. Search uses
Google q within the same window; its matching semantics include more than titles.

Lists request singleEvents, startTime ordering, showDeleted=false, explicit fields,
and at most two pages of 50 events. A remaining nextPageToken means incomplete.
A nextSyncToken without a nextPageToken proves the final page. Missing pagination
evidence stays unknown. Pages are live reads, not a transactional snapshot. Missing
or malformed items never become empty results. Repeated tokens/duplicate IDs fail.

Events preserve start/end, status, location, recurrence instance, source updated
date and link. All-day dates remain date-only and their ends are exclusive.
Unknown updated dates remain null. Descriptions are bounded to 16 KB with explicit
truncation. Source content is data, never dispatch instructions. Context Packs are
private Truth with body-free audit. No model runs on these fixed reads.

The page and fixed chat requests cover today, this week and details by event ID.
Arbitrary follow-up coreference, other calendars, proactive reminders, mutations,
attendee/contact extraction and member workflows are outside this delivery.

Provider references:
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- https://developers.google.com/workspace/calendar/api/v3/reference/events/get
- https://developers.google.com/workspace/calendar/api/v3/reference/calendars/get

Evidence distinguishes candidate source reads from the restarted HTTP/chat/UI
process. Wider Calendar integration remains partial. Memory completion is tracked
independently; queue completion does not mean semantic indexing is complete.
