# HR workspace layout v1

The attendance form previously reserved up to 55vh above the transcript. At a short desktop viewport the saved result became a thin scrolling strip.

The HR workspace now uses a compact heading with Attendance tools and Follow-ups disclosures. Both open as bounded overlays rather than resizing the transcript. Escape returns focus to the relevant disclosure; clicking outside closes the overlay. Queries still require an explicit Winnipeg date, preparation only fills an empty composer, and tools close after dispatch rather than preparation. Existing follow-up storage and source permissions are unchanged.

Markdown tables retain every cell and evidence label. Expand table opens a native modal with horizontal and vertical scrolling, sticky column headings and a return button. Escape closes the modal and restores focus. Known 7shifts provenance footers are collapsed without deleting their content; recommendations and evidence uncertainty remain in the main report. Composer notes share a compact footer; model availability failures remain visible and continue to block sending.

Browser acceptance covers Chinese desktop 1280x720 and English mobile 390x844, reading area height, draft preservation, explicit-date preparation, dispatch collapse, modal cell equality, keyboard return, source disclosure, persistent isolated follow-ups and unavailable-model warnings. Fixture tests do not call providers or change business records. Live UI acceptance uses an existing saved report; UI correctness does not establish model subscription availability or source freshness.
