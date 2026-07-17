# Render and verification workflow

1. Create a new empty workspace directory for the render.
2. Run `render_docx.py <input.docx> --output-dir <dir> --emit-pdf`.
3. Confirm the JSON summary reports at least one page.
4. When image input is supported, open every `page-<NNN>.png` with `view_image`.
5. Check for clipping, overlap, missing glyphs, dense tables, stranded headings, accidental blank pages, and inconsistent headers or footers.
6. Correct the source and render into another fresh directory.

LibreOffice performs the DOCX-to-PDF conversion. `PyMuPDF` rasterizes the resulting PDF. If LibreOffice is missing, report structural validation only; do not silently use an unrelated renderer with different layout behavior.
