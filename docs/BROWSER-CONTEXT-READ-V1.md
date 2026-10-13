# Browser Context Read v1

This slice adds a Chrome Manifest V3 side panel and one current-page **read**
capability. It does not enable browser clicks, typing, navigation, screenshots,
Windows desktop control, downloads, cookies, arbitrary scripts or business writes.

## One shared brain

The authenticated Backend composes `src/browserRead/service.js` with the existing
model center and subscription adapter. Preparation snapshots the central model
and effort; a later settings change cannot silently switch this request. The
subscription bridge remains server-to-server and rejects browser Origin headers.
There is no second agent brain, API-credit fallback or startup model call.
Requested model and provider-reported actual model are separate; absent actual
model evidence stays unknown.

## Consent and observation

The toolbar action grants Chrome activeTab access. Opening a panel alone never
calls a model. The fixed collector runs in the isolated world of the selected
main frame. It excludes inputs, textarea/select, editable nodes, hidden nodes,
scripts and other frames. It collects at most approximately 6,000 characters
and 5,000 text nodes, explicitly declaring truncation. This is bounded rendered
DOM text, not a complete page, screenshot, OCR or assurance that every sensitive
value was detectable. The local preview shows the collected text, site, model,
effort and omitted scope before explicit external-model consent.

The worker registers an explicit `chrome.action.onClicked` handler and disables
automatic action-to-panel toggling. A side-panel button is not itself an activeTab
grant. The handler opens only the window returned by Chrome's toolbar action;
it does not read a page or call the model. Preparation gets the panel's own
window ID, and read verification rechecks that same prepared window instead of
whichever unrelated Chrome/PWA window most recently acquired focus. Opening a
panel from another browser entry point can still require the toolbar gesture.
No persistent host permissions or new Chrome permissions are added.

The server binds the lease to tab/window/document/main-frame identity, URL digest,
content digest and captured central choice. The worker re-collects on confirmation,
refusing changed text, URL or document. The Backend additionally validates digest
and freshness. Existing government-submission origin restrictions remain enforced.
HTTPS public-page scope excludes local/private address forms and the initial
listed sensitive host classes; it is not a comprehensive financial-site detector.
Neither a page nor its text can grant authority or become executable tool code.

## Native broker and installation

The extension has only sidePanel, activeTab, scripting, nativeMessaging and storage
permissions. It has no all-sites host permission, permanent content script,
externally_connectable entry, debugger, cookies or downloads permission.

`scripts/browser/install-read-host.ps1` prepares canonical reviewed Git blobs,
builds a fixed C# launcher and registers only
`HKCU/Software/Google/Chrome/NativeMessagingHosts/com.imagine.browser_read`.
No administrator or new Windows service permission is requested. The native
manifest names only the fixed public-key-derived extension ID. The launcher pins
the broker/config/module content hashes and starts only the fixed Node runtime.
The broker validates the Chrome caller origin and accepts only prepare/read/get/
cancel against one fixed loopback endpoint. No route, shell command, executable,
path or model choice is accepted from the extension. The existing service token
is read in host memory from the same Owner User environment as the launcher;
it is never exposed to page, extension, model, receipt or log.

The manifest public key stabilizes the unpacked extension ID. It is not a secret,
authentication credential or retained signing private key. The installation receipt
retains the previous registration for rollback. Packages are kept outside MSIX
AppData virtualization under `%USERPROFILE%/.imagine/browser-context-read`.
The host trusts the Windows Owner; it does not defend against malicious software
already able to read that Owner's environment or replace their executable files.

## Persistence, cost and failure

Preparation and status do not infer. Consent is persisted as consumed before one
model dispatch; repeated messages return saved state and cannot repeat inference.
The request has a bounded 110-second model deadline, five-minute consent expiry,
one active read and at most 500 retained records before a visible capacity refusal.
Cancellation aborts the client request, discards late answers and cannot undo usage
already incurred. Restart interrupts unfinished work without retry. Lost replies
are recovered by get, never automatic resend.

The raw page text, full URL, prompts, title, cookies and tokens are not saved in
the read store. The Owner question, model answer, source origin, digests, identities,
capture time and metadata timeline are saved locally. Answers can themselves
contain consented sensitive page data; the UI states answer persistence before
consent. The extension saves only the latest job ID, not page content or credentials.
This v1 does not copy page text into long-term memory or start background processing.

## Acceptance and limits

Automated checks cover consent, one dispatch, changed context, stale evidence,
restart, cancel, failed persistence, frame bounds, actual-model honesty, token/
Origin guards, native framing, source/permission surveys, native launcher compilation
and wrong-extension refusal. Real isolated Edge DOM/UI fixtures measure text
exclusion, truncation, layout and escaped rendering. They are fixture evidence,
not successful Chrome native-host installation or a live subscription answer.

Live acceptance additionally requires loading the reviewed unpacked extension,
opening the toolbar side panel on an approved HTTPS page, confirming the preview,
observing the answer and actual model, and checking source/time against that page.
Source changes and unavailable grants must refuse before model dispatch.
Chrome extension installation/update remains a human-visible permission checkpoint.

## Recovery

Backend deployment follows Autonomous Repository Promotion Policy with an exact
remote-preserved SHA, tests/review, rollback point and runtime verification. Host
registration is a distinct Owner-approved scope, never implied by repository
promotion. Restore the previous exact manifest path from installation.json to
revert registration; where no previous registration existed, remove only this
named per-user host key. Retain package/history/evidence files. A restored older
Backend without the route makes the new host unavailable; it never invents a
fallback endpoint or model.
