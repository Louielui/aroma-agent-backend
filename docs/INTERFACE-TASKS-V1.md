# Sidebar interface tasks v1

The local backend now registers one additional closed interface profile:
`src/demo/assets/sidebar.js` and `src/demo/assets/sidebar.css`. A task selects one
or both existing files. The unselected sibling remains a read-only dependency.
Profiles cannot be mixed. Chat plans read this same source set and can prepare
task drafts after explicit goal, criteria and scope confirmation. The task page
also exposes the two profiles; selecting a profile selects no editable file.

Registration, coding, adoption and rollback retain their independent approvals.
Protected test drafts execute only inside offline Windows Sandbox. The package
validator accepts CSS in addition to JavaScript/JSON, with unchanged path, size,
secret and isolation restrictions. The administrator reload helper validates the
same closed sets against the committed registry before reloading the backend.

The host installs the initial standalone sidebar module and integrates it with
the existing page. It groups existing destination nodes into Daily work,
Development and Management. It never replaces buttons, handlers or conversations.
Group collapse state stays within the current page. No browser persistence,
credentials or conversation storage is introduced. Collapsed navigation is inert,
and focus moves to its
visible toggle. Escape closes navigation only with focus inside it. Labels use
the existing Chinese/English resolver. Both assets participate in the stale-tab
fingerprint and remain self-contained in the same-origin document.

Acceptance supports deterministic Node.js DOM behavior tests, source/CSS checks
for responsive/theme/focus rules, protected test hashes and offline OS execution.
DOM doubles and CSS checks are not browser rendering or visual acceptance. Real
browser visual acceptance, arbitrary screens, the composer, task authority UI,
settings, new files, other projects, installations, automatic adoption, remote
push and production writes remain unconnected. Approved deployed JavaScript can
affect the browser; scope checks alone do not prove its semantics or safety.
Independent code review and Owner review remain necessary.

Memory completion acceptance remains paused. This chapter does not resume it.
