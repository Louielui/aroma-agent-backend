# Xiangxiang UI system v1

Direction: quiet workspace, warm orange identity, neutral surfaces, chat-first composition. Use the existing system sans-serif and mono stacks; do not download fonts or add a component library.

Tokens live in `src/demo/assets/app.css` and the presentation overrides in `sidebar.css`.
- Color: --bg, --panel, --card, --ink, --muted, --divider, --line, --accent, --focus. Existing light/dark colors are authoritative. Use the orange brand dot once; reserve accent for a primary action or actual current state.
- Density: --ui-header-height: 56px, --ui-control-height: 36px, --ui-menu-width: 256px. Navigation is compact; preserve at least 36px controls and visible focus. Allow 44px touch rows in mobile menus.
- Spacing: use 4/8/12/16/24px steps. Align text and icons. No full-width three-column navigation or repeated brand rows.
- Shape: 8px controls, 12px menus, existing composer radius. One fine divider between header, history and chat; soft shadow only on floating menus.
- Typography: 14px navigation, 12px secondary timestamps, existing 16px messages with 1.6 line-height. Truncate conversation titles, never destination labels.
- Layout: one compact desktop header. Cluster Home and three functional groups; put settings at the end. Give history the sidebar's remaining height with independent scroll. Preserve the central conversation column and composer. At narrow widths wrap the header deliberately, collapse history initially, and use floating menus with bounded viewport height. No page-level horizontal overflow.
- Work: keep the real changing action line next to the conversation/composer. Animate only actual running work; Thinking means a model response is pending. Keep logs, hashes and code behind an explicit disclosure.
- States: hover, keyboard focus, open menu, selected destination, pending work, completed work and failed read must be distinguishable. Escape closes the active menu and restores its trigger; outside clicks and destination selection close menus. Respect reduced motion.

Preview checks: desktop and mobile, Chinese and English, dark/light, short windows, keyboard and scrolling. Compare pixels for balance and hierarchy; use browser geometry for clipping and hit testing. Keep measured functional acceptance and visual review as separate receipts.
