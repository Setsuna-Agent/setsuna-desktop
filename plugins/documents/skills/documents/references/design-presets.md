# Document design presets

Choose one preset for a new document. Existing-document edits keep the source document's visual system unless the user requests a redesign.

## `business`

Best for proposals, project briefs, decision records, reports, and formal memos.

- Page: A4 by default, 22 mm side margins, 20 mm top and bottom margins.
- Body: Arial 10.5 pt; East Asian text requests Microsoft YaHei and allows renderer substitution.
- Title: 25 pt semibold, dark navy.
- Heading ladder: 16 pt / 13 pt / 11 pt.
- Accent: `#315E7D`.
- Body rhythm: 1.16 line spacing with 6 pt paragraph spacing.
- Tables: dark accent header, white header text, fixed grid geometry, moderate cell padding.

## `compact`

Best for operator guides, dense references, checklists, and short internal handbooks.

- Page: A4 by default, 18 mm side margins, 17 mm top and bottom margins.
- Body: Arial 9.5 pt.
- Title: 22 pt semibold.
- Heading ladder: 14 pt / 12 pt / 10.5 pt.
- Accent: `#4F5D75`.
- Body rhythm: 1.08 line spacing with 4 pt paragraph spacing.
- Tables: compact padding while retaining wrapping and readable line height.

## Shared constraints

- Use a real heading hierarchy and real Word list styles.
- Never use fixed table-row heights; wrapped content must be allowed to expand.
- Give narrative columns more width than dates, status, scores, or identifiers.
- Do not use tables as generic page-layout containers.
- Keep headings with the paragraph that follows where possible.
- Use restrained color. Emphasis should primarily come from hierarchy, whitespace, and weight.
- When content is tight, revise text or geometry before reducing body text below the preset.
