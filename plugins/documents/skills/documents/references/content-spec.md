# DOCX content specification

`create_docx.py` accepts one UTF-8 JSON object. Unknown fields are ignored only at the document-property level; unknown block types fail fast.

## Root fields

```json
{
  "title": "Required document title",
  "subtitle": "Optional subtitle",
  "preset": "business",
  "pageSize": "a4",
  "properties": {
    "subject": "Optional subject",
    "keywords": ["one", "two"],
    "author": "Optional author"
  },
  "metadata": [
    { "label": "Owner", "value": "Product team" }
  ],
  "blocks": []
}
```

- `preset`: `business` or `compact`.
- `pageSize`: `a4` or `letter`; defaults to the preset.
- `metadata`: compact labeled lines below the subtitle.
- `properties.author` is omitted by default so a generated file does not invent personal metadata.

## Inline content

Most text fields accept either a string or an object containing `runs`:

```json
{
  "runs": [
    { "text": "Decision: ", "bold": true },
    { "text": "ship the guarded rollout", "color": "315E7D" }
  ]
}
```

Run fields: `text`, `bold`, `italic`, `underline`, `color`, `size`, and `code`.

## Blocks

### Heading and paragraph

```json
{ "type": "heading", "level": 1, "text": "Overview" }
{ "type": "paragraph", "text": "Body copy.", "align": "justify" }
```

Heading levels are 1–3. Paragraph alignment accepts `left`, `center`, `right`, or `justify`.

### Lists and checklist

```json
{ "type": "bullets", "items": ["First", "Second"] }
{ "type": "numbered", "items": ["Prepare", "Review", "Publish"] }
{
  "type": "checklist",
  "items": [
    { "text": "Legal review", "checked": true },
    { "text": "Final approval", "checked": false }
  ]
}
```

List items may also be inline-content objects. An item may specify `level` from 0–2.

### Callout and quote

```json
{
  "type": "callout",
  "label": "Recommendation",
  "text": "Start with a controlled pilot.",
  "tone": "info"
}
{ "type": "quote", "text": "A short attributed quotation.", "attribution": "Source" }
```

Callout tones: `info`, `success`, `warning`, and `neutral`.

### Table

```json
{
  "type": "table",
  "columns": ["Workstream", "Owner", "Status"],
  "widths": [5, 2, 2],
  "alignments": ["left", "left", "center"],
  "rows": [
    ["Document workflow", "Mina", "Ready"],
    ["Review gate", "Alex", "In progress"]
  ]
}
```

`widths` are relative weights, not physical units. Rows may also be objects keyed by column name. Keep prose outside tables unless records genuinely share comparable fields.

### Image

```json
{
  "type": "image",
  "path": "figures/architecture.png",
  "widthInches": 5.8,
  "caption": "Figure 1. Processing flow"
}
```

Relative image paths resolve from the JSON specification directory.

### Layout controls

```json
{ "type": "rule" }
{ "type": "spacer", "points": 8 }
{ "type": "pageBreak" }
```

Use explicit page breaks sparingly. Prefer natural flow and heading keep-with-next behavior.
