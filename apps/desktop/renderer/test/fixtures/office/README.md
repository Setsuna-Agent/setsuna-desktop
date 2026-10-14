Synthetic Office documents for the offline preview integration test. These files
contain no user data and are intentionally small:

- DOCX: one paragraph with Latin and Chinese text.
- Continuous-sections DOCX: synthetic text in two continuous sections, with a
  70.85 pt top margin and twelve 21.6 pt lines. Reconstructing the shared section
  edge through subtraction/addition produces single-ULP drift; both rendering
  modes must still parse, paint and preserve the text on each side of the break.
- PPTX: one slide with a text box.
- XLSX: two worksheets, inline strings and a basic style table.
- CSV: UTF-8 BOM, leading zeros, a formula-looking string, a quoted comma and a quoted newline.
- PDF: one page with a standard font, opened by Electron's built-in PDF reader.

The integration test loads these using the production format adapters and actual
bundled WASM/Workers in a hidden Electron renderer. It checks parsing, offline
loading and resource release, without layout assertions or screenshots.
