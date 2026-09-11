# DOCX 内容规格

`create_docx.py` 接收一个 UTF-8 JSON 对象。仅文档属性层会忽略未知字段；未知内容块类型会立即报错。

## 根字段

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

- `preset`：`business` 或 `compact`。
- `pageSize`：`a4` 或 `letter`；默认采用预设。
- `metadata`：副标题下方带标签的紧凑信息行。
- 默认省略 `properties.author`，避免生成文件编造个人元数据。

## 行内内容

多数字段支持字符串或包含 `runs` 的对象：

```json
{
  "runs": [
    { "text": "Decision: ", "bold": true },
    { "text": "ship the guarded rollout", "color": "315E7D" }
  ]
}
```

文本段字段：`text`、`bold`、`italic`、`underline`、`color`、`size`、`code`。

## 内容块

### 标题与段落

```json
{ "type": "heading", "level": 1, "text": "Overview" }
{ "type": "paragraph", "text": "Body copy.", "align": "justify" }
```

标题级别为 1–3。段落对齐可用 `left`、`center`、`right`、`justify`。

### 列表与检查清单

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

列表项也可以是行内内容对象，可指定 0–2 的 `level`。

### 提示块与引用

```json
{
  "type": "callout",
  "label": "Recommendation",
  "text": "Start with a controlled pilot.",
  "tone": "info"
}
{ "type": "quote", "text": "A short attributed quotation.", "attribution": "Source" }
```

提示块类型：`info`、`success`、`warning`、`neutral`。

### 表格

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

`widths` 是相对权重，不是物理单位。行也可以是以列名为键的对象。除非记录确实包含可比较字段，否则把长篇文字放在表格外。

### 图片

```json
{
  "type": "image",
  "path": "figures/architecture.png",
  "widthInches": 5.8,
  "caption": "Figure 1. Processing flow"
}
```

图片相对路径以 JSON 规格文件所在目录为基准。

### 布局控制

```json
{ "type": "rule" }
{ "type": "spacer", "points": 8 }
{ "type": "pageBreak" }
```

谨慎使用显式分页，优先自然流动和标题与下段同页的行为。
