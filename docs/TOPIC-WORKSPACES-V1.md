# Owner topic workspaces v1

Every existing top-level function opens its own `/demo?topic=<closed-key>` workspace. The original tool route remains available through a collapsed tool panel and a separate-page link. The sidebar lists only conversations explicitly linked to that workspace. Existing global conversations are not inferred from titles or migrated. Returning to a workspace restores its last linked conversation through the normal protected transcript loader.

Membership and Owner tracking notes are stored atomically in `topic-workspaces.json` under the canonical data directory. Notes have an explicit next step and Owner-maintained `todo`, `doing`, or `done` status; they are not execution records. Creates are idempotent and updates compare revisions. Damaged storage is reported as unavailable and is never reset. No provider credentials, source body, or model trace enters this store.

The EMAIL reader passes only mailbox, message ID and a bounded title to the enclosing workspace. The receiving page verifies the same origin and exact iframe sender. Reading in conversation prepares a source-ID request in the composer; the Owner sends it through the existing permission-checked Gmail reader. Source access is reread, not granted by a saved reference. Original mail remains transient and the existing neutral conversation receipt is preserved. A tracking reference never claims that mail was sent or a source was newly verified.

This surface is Owner-only behind the existing authorization boundary and conversation feature gate. Mutations require the same origin and closed schemas. It adds no source rights, external writes, automatic dispatch, or member access. Existing worker execution and independent-review gates are unchanged. The earlier failed review receipt is retained; it is not retried by entering a topic.

Acceptance covers restart persistence, topic separation, stale updates, corrupt-store preservation, authorization, origin and schema rejection, bilingual source requests, and desktop/mobile browser behavior. Source integrations retain their measured partial or unavailable states in the architecture inventory.
