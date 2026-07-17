# Read and review workflow

1. Run `scripts/inspect_docx.py` and read its warnings before extracting conclusions.
2. Extract text and tables with `python-docx` only after confirming whether comments, fields, or tracked changes are present.
3. Preserve context: heading, table header, row label, footnote marker, revision state, and nearby qualifiers.
4. Render when the answer depends on location, visual grouping, charts, shapes, or page layout.
5. Do not modify or re-export a document for a read-only question.

The inspector counts OOXML structures but does not interpret drawing-layer text, formulas, embedded files, or every Word field. State that limitation when it affects the answer.
