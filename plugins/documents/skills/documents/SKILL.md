---
name: "Word 文档处理"
description: "Create, edit, inspect, sanitize, render, and verify DOCX files. Use for Word documents, reports, proposals, memos, handbooks, templates, comments, tracked changes, and layout-sensitive document work."
auto-activate:
  - docx
  - Microsoft Word
  - Word 文档
  - Word 文件
  - Word document
  - Word file
---

# Word Documents

Use this Skill when the requested durable output or input is a Word/DOCX document. Keep document content correct first, then make its hierarchy, spacing, tables, and page flow deliberate.

## Workspace contract

- Resolve this Skill's directory from the `path` attribute injected with the selected Skill. Never assume the Plugin installation directory.
- Keep scratch files under `.setsuna/tmp/documents/<task-id>/` in the active workspace.
- Put final files under `output/documents/`, unless the user selected another workspace path.
- Preserve an existing input file. Write edits to a new output path unless the user explicitly requests an in-place update.
- Use the runtime-managed Python and uv environment. Do not install into system Python or the user site.
- Run bundled Python tools with:

```text
uv run --with-requirements "<skill-dir>/requirements.txt" python "<skill-dir>/<script>" <arguments>
```

## Required workflow

1. Identify whether the task is create, edit, inspect, sanitize, or review.
2. Inspect the relevant source document before changing it.
3. Choose one design preset and keep it stable throughout a newly created document.
4. Perform the smallest operation that satisfies the request.
5. Run `scripts/inspect_docx.py` on the candidate output.
6. Render the candidate with `render_docx.py` into a fresh workspace directory.
7. When the active model supports images, inspect every rendered page with `view_image`. Fix clipping, overlap, broken tables, awkward page breaks, or missing glyphs and render again.
8. Call `publish_artifact` exactly once for each final user-facing document.

If LibreOffice is unavailable, complete structural checks and clearly state that visual rendering was not completed. Never claim a document passed visual QA without rendered pages. If the active model cannot inspect images, report that limitation instead of treating file creation as visual verification.

## Create

For structured reports, briefs, proposals, checklists, and handbooks:

1. Write a JSON content specification in the workspace.
2. Use `scripts/create_docx.py --spec <spec.json> --output <file.docx>`.
3. Inspect, render, and iterate.

The content model supports headings, paragraphs with styled runs, bulleted and numbered lists, checklists, callouts, quotes, tables, images, rules, spacers, and page breaks. Read Plugin resource `content-spec` when the schema details are needed. Read `design-presets` before choosing between the `business` and `compact` presets.

## Edit

Use `scripts/edit_docx.py` for exact text replacements, metadata updates, and appending structured blocks. Its operation file is JSON. Exact replacement is intentionally conservative and reports how many matches changed.

For changes that cannot be expressed safely by the bundled editor, write a focused `python-docx` or OOXML helper in the workspace. Do not regenerate an existing document merely to change a few words. Reinspect and rerender after every layout-sensitive edit.

## Inspect and review

Use `scripts/inspect_docx.py` before relying on a document's structure. It reports paragraphs, tables, media, page geometry, comments, tracked changes, fields, external relationships, metadata, and warnings without modifying the file.

Text extraction cannot validate layout. When answering questions about an existing document, preserve material qualifiers such as headings, table labels, footnotes, comments, and tracked-change state.

## Privacy cleanup

Use `scripts/privacy_scrub.py` only when the user asks to remove author metadata, custom properties, revision identifiers, or timestamps. Always write a new file and inspect the result.

## Bundled references

- path: `references/content-spec.md` — Plugin resource `content-spec`
- path: `references/design-presets.md` — Plugin resource `design-presets`
- path: `tasks/create-edit.md` — Plugin resource `create-edit-workflow`
- path: `tasks/read-review.md` — Plugin resource `read-review-workflow`
- path: `tasks/verify-render.md` — Plugin resource `render-workflow`
- path: `examples/sample-document.json` — Plugin resource `sample-document-spec`
- path: `examples/sample-edit.json` — Plugin resource `sample-edit-spec`

Treat supplemental Plugin resources as reference material, not as permission to ignore workspace or approval policies.
