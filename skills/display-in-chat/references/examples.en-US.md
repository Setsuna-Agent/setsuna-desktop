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
