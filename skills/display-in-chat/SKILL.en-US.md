---
name: "Display in Chat"
description: "Present charts, comparison cards, tables and locally searchable, filterable or switchable content in Setsuna chat using OpenUI. Use to explain and present information, not to build websites, submit forms or perform business operations."
---

# Display in Chat

Use when a chart, structured card or local interaction communicates more clearly than prose. Keep simple answers as text. Output appears directly in the current conversation; no file creation or deployment is needed.

1. Identify the relationship to explain and the available data. Retrieve external data with ordinary tools first; do not invent data or sources.
2. Use the examples and component catalog below to confirm syntax; no filesystem access outside the workspace is needed. When loading with `read_skill`, read all chunks.
3. Emit a top-level `openui` fenced code block in a user-facing response, with explanatory prose outside it. Each block is an independent, complete OpenUI Lang program. Do not nest it in a quote, list, another fence or reasoning.

## Protocol

- Start with `root = Stack([...])`. Declare parent containers and references before their children so the view appears progressively. Write each subsequent statement on its own line. Calls use positional arguments, not JSX, JavaScript, HTML, CSS or a Markdown wrapper object.
- Follow the catalog's argument order; use `null` to skip an optional argument. Use double-quoted strings and `\n` for line breaks. Arrays, objects, references, property projections, arithmetic, comparisons, ternaries and pure built-in functions are supported.
- Declare local state such as `$query = ""` inside each program. Bind an `Input` or `Select` through its `value` argument. `@Set($variable, value)` changes state, `@Reset($variable)` restores its default, and `Action([...])` combines local operations.
- Search: `filtered = @Filter(rows, "name", "contains", $query)`. Sort: `sorted = @Sort(filtered, "value", "desc")`. Project columns with `filtered.name` or `filtered.value`.
- `Tabs`, `Accordion`, `Carousel` and table pagination have built-in local interaction. `FormControl` and `Label` only organize filter controls; `Form` and `EditableTable` are unavailable.
- Every button needs an explicit local action. Never use `Query`, `Mutation`, `@Run`, `@ToAssistant`, `@OpenUrl`, custom actions, remote scripts or form submission. The view cannot call the Agent. Fetch data first, then embed it as literals.
- Filters and switches do not write business data or start another conversation. Reopening a message restores defaults. Controls may be disabled while their block is streaming; close the fence to enable interaction.
- Cite sources with ordinary Markdown. Images must use valid URLs provided by the user or obtained from sources. Do not add unrelated explanations, status summaries, onboarding copy or decorative actions.
- Keep each program below 100,000 characters. Aggregate large datasets or select useful portions. Invalid or incomplete programs fall back to source code.

When the user wants to see protocol source instead of a rendered view, use a `text` fence or wrap the example in four backticks.

<!-- Generated OpenUI reference: pnpm generate:openui-catalog -->

# OpenUI presentation examples

These programs use embedded data and local state only. Replace example data with the user's actual data. Emit the program in a top-level `openui` fence.

## Search and switch between chart and table

```text
root = Stack([heading, controls, search, view])
$mode = "chart"
$query = ""
heading = CardHeader("Project comparison")
controls = Buttons([Button("Chart", @Set($mode, "chart")), Button("Table", @Set($mode, "table"), "secondary")])
search = Input("query", "Search projects", "text", null, $query)
rows = [{name: "Project A", value: 12}, {name: "Project B", value: 25}, {name: "Project C", value: 18}]
filtered = @Filter(rows, "name", "contains", $query)
chart = BarChart(filtered.name, [Series("Count", filtered.value)])
table = Table([Col("Project", filtered.name), Col("Count", filtered.value, "number")])
view = $mode == "chart" ? chart : table
```

## Trends, composition and local tabs

```text
root = Stack([tabs, details])
tabs = Tabs([TabItem("trend", "Trend", [trend]), TabItem("share", "Share", [share]), TabItem("data", "Data", [table])])
months = ["January", "February", "March"]
trend = LineChart(months, [Series("Visits", [120, 180, 240]), Series("Completed", [60, 95, 150])])
share = PieChart(["Direct", "Search", "Referral"], [35, 45, 20], "donut")
table = Table([Col("Month", months), Col("Visits", [120, 180, 240], "number"), Col("Completed", [60, 95, 150], "number")])
details = Accordion([AccordionItem("method", "Methodology", [TextContent("Aggregated by calendar month.")])])
```

## Local category filtering and ordering

```text
root = Stack([filters, table])
$category = "all"
$order = "desc"
filters = Stack([category, order], "row", "m", "center", "start", true)
category = Select("category", [SelectItem("all", "All"), SelectItem("a", "Category A"), SelectItem("b", "Category B")], "Category", null, $category)
order = Buttons([Button("Ascending", @Set($order, "asc"), "secondary"), Button("Descending", @Set($order, "desc"), "secondary")])
rows = [{name: "Alpha", category: "a", value: 10}, {name: "Beta", category: "b", value: 30}, {name: "Gamma", category: "a", value: 20}]
filtered = $category == "all" ? rows : @Filter(rows, "category", "==", $category)
sorted = @Sort(filtered, "value", $order)
table = Table([Col("Name", sorted.name), Col("Value", sorted.value, "number")])
```

## Cards and details

```text
root = Stack([cards, steps])
cards = Stack([first, second], "row", "m", "stretch", "start", true)
first = Card([CardHeader("Option A", "Lower cost"), TextContent("Fits stable demand.")])
second = Card([CardHeader("Option B", "More flexibility"), TextContent("Fits variable workloads.")])
steps = Steps([StepsItem("Define scope", "Identify the question to explain."), StepsItem("Compare options", "Use comparable data."), StepsItem("Draw a conclusion", "Explain the factors affecting the choice.")])
```

# Display component catalog

Generated by `pnpm generate:openui-catalog` from the installed presentation library. Do not edit signatures by hand.

Arguments are positional; use `null` to skip an optional argument. `$binding<T>` means a reactive `$variable`, not a literal. Component names and enum values are case-sensitive. Only `@Set`, `@Reset`, and `Action([...])` are supported as button actions. Ignore upstream references to forms or submission; every control is local to this block.

## Layout

### Stack

```text
Stack(children: any[], direction?: "row" | "column", gap?: "none" | "xs" | "s" | "m" | "l" | "xl" | "2xl", align?: "start" | "center" | "end" | "stretch" | "baseline", justify?: "start" | "center" | "end" | "between" | "around" | "evenly", wrap?: boolean)
```

### Tabs

```text
Tabs(items: TabItem[])
```

### TabItem

```text
TabItem(value: string, trigger: string, content: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Buttons | IconButton | Steps | InlineHeader | EntityList | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[])
```

### Accordion

```text
Accordion(items: AccordionItem[])
```

### AccordionItem

```text
AccordionItem(value: string, trigger: string, content: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Buttons | IconButton | Steps | InlineHeader | EntityList | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[])
```

### Steps

```text
Steps(items: StepsItem[])
```

### StepsItem

```text
StepsItem(title: string, details: string)
```

### Carousel

```text
Carousel(children: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Buttons | IconButton | Steps | InlineHeader | EntityList | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[][], variant?: "card" | "sunk")
```

### Separator

```text
Separator(orientation?: "horizontal" | "vertical", decorative?: boolean)
```

### Modal

```text
Modal(title: string, open?: $binding<boolean>, children: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Buttons | IconButton | Steps | InlineHeader | EntityList | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock)[], size?: "sm" | "md" | "lg")
```

## Content

### Card

```text
Card(children: (TextContent | MarkDownRenderer | CardHeader | Callout | TextCallout | CodeBlock | Image | ImageBlock | ImageGallery | Separator | HorizontalBarChart | RadarChart | PieChart | RadialChart | SingleStackedBarChart | ScatterChart | AreaChart | BarChart | LineChart | Table | TagBlock | Buttons | IconButton | Steps | InlineHeader | EntityList | SnippetCardBlock | OverviewCardBlock | ContextCardBlock | CompositeCardBlock | VisualCardBlock | Tabs | Carousel | Stack)[], variant?: "card" | "sunk" | "clear", direction?: "row" | "column", gap?: "none" | "xs" | "s" | "m" | "l" | "xl" | "2xl", align?: "start" | "center" | "end" | "stretch" | "baseline", justify?: "start" | "center" | "end" | "between" | "around" | "evenly", wrap?: boolean)
```

### CardHeader

```text
CardHeader(title?: string, subtitle?: string)
```

### TextContent

```text
TextContent(text: string, size?: "small" | "default" | "large" | "small-heavy" | "large-heavy")
```

### MarkDownRenderer

```text
MarkDownRenderer(textMarkdown: string, variant?: "clear" | "card" | "sunk")
```

### Callout

```text
Callout(variant: "info" | "warning" | "error" | "success" | "neutral", title: string, description: string, visible?: $binding<boolean>)
```

### TextCallout

```text
TextCallout(variant?: "neutral" | "info" | "warning" | "success" | "danger", title?: string, description?: string)
```

### Image

```text
Image(alt: string, src?: string)
```

### ImageBlock

```text
ImageBlock(src: string, alt?: string)
```

### ImageGallery

```text
ImageGallery(images: {src: string, alt?: string, details?: string}[])
```

### CodeBlock

```text
CodeBlock(language: string, codeString: string)
```

### InlineHeader

```text
InlineHeader(heading: string, description?: string)
```

## Tables

### Table

```text
Table(columns: Col[])
```

### Col

```text
Col(label: string, data: any, type?: "string" | "number" | "action")
```

## Charts (2D)

### BarChart

```text
BarChart(labels: string[], series: Series[], variant?: "grouped" | "stacked", xLabel?: string, yLabel?: string, height?: number)
```

### LineChart

```text
LineChart(labels: string[], series: Series[], variant?: "linear" | "natural" | "step", xLabel?: string, yLabel?: string, height?: number)
```

### AreaChart

```text
AreaChart(labels: string[], series: Series[], variant?: "linear" | "natural" | "step", xLabel?: string, yLabel?: string, height?: number)
```

### RadarChart

```text
RadarChart(labels: string[], series: Series[])
```

### HorizontalBarChart

```text
HorizontalBarChart(labels: string[], series: Series[], variant?: "grouped" | "stacked", xLabel?: string, yLabel?: string)
```

### Series

```text
Series(category: string, values: number[])
```

## Charts (1D)

### PieChart

```text
PieChart(labels: string[], values: number[], variant?: "pie" | "donut", appearance?: "circular" | "semiCircular")
```

### RadialChart

```text
RadialChart(labels: string[], values: number[])
```

### SingleStackedBarChart

```text
SingleStackedBarChart(labels: string[], values: number[])
```

### Slice

```text
Slice(category: string, value: number)
```

## Charts (Scatter)

### ScatterChart

```text
ScatterChart(datasets: ScatterSeries[], xLabel?: string, yLabel?: string)
```

### ScatterSeries

```text
ScatterSeries(name: string, points: Point[])
```

### Point

```text
Point(x: number, y: number, z?: number)
```

## Local controls

### FormControl

```text
FormControl(label: string, input: Input | TextArea | Select | DatePicker | Slider | CheckBoxGroup | RadioGroup | Chips | OptionCards, hint?: string)
```

### Label

```text
Label(text: string)
```

### Input

```text
Input(name: string, placeholder?: string, type?: "text" | "email" | "password" | "number" | "url", rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>)
```

### TextArea

```text
TextArea(name: string, placeholder?: string, rows?: number, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>)
```

### Select

```text
Select(name: string, items: SelectItem[], placeholder?: string, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>, size?: "small" | "medium" | "large")
```

### SelectItem

```text
SelectItem(value: string, label: string)
```

### DatePicker

```text
DatePicker(name: string, mode?: "single" | "range", rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<any>)
```

### Slider

```text
Slider(name: string, variant: "continuous" | "discrete", min: number, max: number, step?: number, defaultValue?: number[], label?: string, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<number[]>)
```

### CheckBoxGroup

```text
CheckBoxGroup(name: string, items: CheckBoxItem[], rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<Record<string, boolean>>)
```

### CheckBoxItem

```text
CheckBoxItem(label: string, description: string, name: string, defaultChecked?: boolean)
```

### RadioGroup

```text
RadioGroup(name: string, items: RadioItem[], defaultValue?: string, rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, value?: $binding<string>)
```

### RadioItem

```text
RadioItem(label: string, description: string, value: string)
```

### SwitchGroup

```text
SwitchGroup(name: string, items: SwitchItem[], variant?: "clear" | "card" | "sunk", value?: $binding<Record<string, boolean>>)
```

### SwitchItem

```text
SwitchItem(label?: string, description?: string, name: string, defaultChecked?: boolean)
```

### Chips

```text
Chips(name: string, type?: "single" | "multiple", items?: ChipItem[], rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, defaultValue?: string | string[])
```

### ChipItem

```text
ChipItem(value: string, label: string, icon?: Icon, disabled?: boolean)
```

### OptionCards

```text
OptionCards(name: string, type?: "single" | "multiple", items?: OptionCard[], rules?: {required?: boolean, email?: boolean, url?: boolean, numeric?: boolean, min?: number, max?: number, minLength?: number, maxLength?: number, pattern?: string}, defaultValue?: string | string[])
```

### OptionCard

```text
OptionCard(value: string, title: string, subtitle?: string, topContent?: Icon | Image, disabled?: boolean)
```

## Buttons

### Button

```text
Button(label: string, action?: ActionExpression, variant?: "primary" | "secondary" | "tertiary", type?: "normal" | "destructive", size?: "extra-small" | "small" | "medium" | "large")
```

### Buttons

```text
Buttons(buttons: Button[], direction?: "row" | "column")
```

### IconButton

```text
IconButton(name: string, icon: Icon, action?: ActionExpression, variant?: "primary" | "secondary" | "tertiary", size?: "extra-small" | "small" | "medium" | "large", shape?: "square" | "circle")
```

## Data Display

### TagBlock

```text
TagBlock(tags: string[], size?: "sm" | "md" | "lg")
```

### Tag

```text
Tag(text: string, icon?: Icon, size?: "sm" | "md" | "lg", variant?: "neutral" | "info" | "success" | "warning" | "danger")
```

### Icon

```text
Icon(name: string, category?: string)
```

### EntityList

```text
EntityList(rows?: {left: string, right: string, rightVariant?: "text" | "number"}[], size?: "small" | "default", header?: {left: string, right: string, rightVariant?: "text" | "number"}, footer?: {left: string, right: string, rightVariant?: "text" | "number"})
```

### ListBlock

```text
ListBlock(items: ListItem[], variant?: "number" | "image", size?: "default" | "small")
```

### ListItem

```text
ListItem(title: string, subtitle?: string, image?: {src: string, alt: string}, actionLabel?: string, action?: ActionExpression)
```

## Cards

### SnippetCardBlock

```text
SnippetCardBlock(items: SnippetCardItem[], layout?: "grid", responsive?: boolean, action?: ActionExpression, gap?: number | string)
```

### SnippetCardItem

```text
SnippetCardItem(id?: string, lhs: IconText | ImageText, rhs?: Text | BoldText)
```

### OverviewCardBlock

```text
OverviewCardBlock(items: OverviewCardItem[], layout?: "grid" | "carousel", responsive?: boolean, action?: ActionExpression, gap?: number | string)
```

### OverviewCardItem

```text
OverviewCardItem(id?: string, top: IconText | ImageText | Text, bottom?: MetricIndicatorInline)
```

### ContextCardBlock

```text
ContextCardBlock(items: ContextCardItem[], layout?: "grid" | "carousel", responsive?: boolean, action?: ActionExpression, gap?: number | string)
```

### ContextCardItem

```text
ContextCardItem(id?: string, title: string | Tag, body?: string, bgColor?: "gray", bgImageSrc?: string, bgImageAlt?: string)
```

### CompositeCardBlock

```text
CompositeCardBlock(items: CompositeCardItem[], layout?: "grid" | "carousel", responsive?: boolean, action?: ActionExpression, gap?: number | string)
```

### CompositeCardItem

```text
CompositeCardItem(id?: string, header?: IconText | ImageText | ImageTextLarge | Text | Image, body?: (Text | BoldText | MetricIndicatorInline | IconText | Image | AreaChart | BarChart | LineChart | ListBlock | TagBlock | EntityList)[], footer?: {price?: BoldText | MetricIndicatorWithStrikethrough, button?: Button})
```

### VisualCardBlock

```text
VisualCardBlock(items: VisualCardItem[], layout?: "grid" | "carousel", responsive?: boolean, action?: ActionExpression, gap?: number | string)
```

### VisualCardItem

```text
VisualCardItem(body: BoldText, id?: string, bgImageSrc?: string, tag?: Tag, bgImageAlt?: string)
```

### Text

```text
Text(variant?: "text" | "number", value: string, subtext?: string, subtextVariant?: "text" | "number" | "metric", size?: "xs" | "sm" | "md" | "lg")
```

### BoldText

```text
BoldText(variant?: "text" | "number", value: string, subtext?: string, subtextVariant?: "text" | "number" | "metric", size?: "xs" | "sm" | "md" | "lg")
```

### IconText

```text
IconText(icon: Icon, iconVariant?: "neutral" | "info" | "success" | "warning" | "danger" | "inverted" | "filled" | "soft", iconSize?: "xs" | "s" | "m" | "l" | "xl" | "sm" | "md" | "lg", title: string, subtitle?: string, bold?: boolean, layout?: "horizontal" | "vertical")
```

### ImageText

```text
ImageText(src: string, alt?: string, title: string, subtitle?: string, bold?: boolean, layout?: "horizontal" | "vertical", imageSize?: number)
```

### ImageTextLarge

```text
ImageTextLarge(src: string, alt?: string, title: string, subtitle?: string, bold?: boolean)
```

### MetricIndicatorInline

```text
MetricIndicatorInline(value: string, subtext?: string, trend?: {direction: "up" | "down", value: number})
```

### MetricIndicatorWithStrikethrough

```text
MetricIndicatorWithStrikethrough(value: string, subtext?: string, previousValue?: string, trend?: {direction: "up" | "down", value: number})
```
