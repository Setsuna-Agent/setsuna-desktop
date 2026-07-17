# Create and edit workflow

## Create

1. Decide the document archetype and intended reader.
2. Choose `business` or `compact` and write a content JSON file in the workspace.
3. Keep long prose in paragraphs; use tables only for repeated comparable records.
4. Run `scripts/create_docx.py`.
5. Run the structural inspector.
6. Render to a fresh page-image directory and inspect every page when image input is available.
7. Revise the JSON or use a focused edit operation, then regenerate or rerender.

## Edit

1. Inspect the source and preserve an untouched copy.
2. Express exact replacements and appended blocks in an operations JSON file.
3. Run `scripts/edit_docx.py` with distinct input and output paths.
4. Confirm every required replacement reports at least one match.
5. Inspect and render the edited copy.

Use Plugin resource `sample-edit-spec` as a minimal operations-file example.

Avoid rebuilding an existing document for a local wording change. The bundled editor intentionally does not alter text boxes, drawing-layer text, or field instructions; use a focused OOXML helper when those structures are in scope.
