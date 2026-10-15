# OpenUI presentation examples

These programs use embedded data and local state only. Replace example data with the user's actual data. Emit the program in a top-level `openui` fence.

## Search and switch between chart and table

```text
root = Stack([heading, controls, search, view])
$mode = "chart"
$query = ""
heading = CardHeader("项目对比")
controls = Buttons([Button("图表", @Set($mode, "chart")), Button("表格", @Set($mode, "table"), "secondary")])
search = Input("query", "搜索项目", "text", null, $query)
rows = [{name: "项目 A", value: 12}, {name: "项目 B", value: 25}, {name: "项目 C", value: 18}]
filtered = @Filter(rows, "name", "contains", $query)
chart = BarChart(filtered.name, [Series("数量", filtered.value)])
table = Table([Col("项目", filtered.name), Col("数量", filtered.value, "number")])
view = $mode == "chart" ? chart : table
```

## Trends, composition and local tabs

```text
root = Stack([tabs, details])
tabs = Tabs([TabItem("trend", "趋势", [trend]), TabItem("share", "占比", [share]), TabItem("data", "数据", [table])])
months = ["一月", "二月", "三月"]
trend = LineChart(months, [Series("访问", [120, 180, 240]), Series("完成", [60, 95, 150])])
share = PieChart(["直接", "搜索", "推荐"], [35, 45, 20], "donut")
table = Table([Col("月份", months), Col("访问", [120, 180, 240], "number"), Col("完成", [60, 95, 150], "number")])
details = Accordion([AccordionItem("method", "统计口径", [TextContent("按自然月汇总。")])])
```

## Local category filtering and ordering

```text
root = Stack([filters, table])
$category = "all"
$order = "desc"
filters = Stack([category, order], "row", "m", "center", "start", true)
category = Select("category", [SelectItem("all", "全部"), SelectItem("a", "A 类"), SelectItem("b", "B 类")], "类别", null, $category)
order = Buttons([Button("升序", @Set($order, "asc"), "secondary"), Button("降序", @Set($order, "desc"), "secondary")])
rows = [{name: "Alpha", category: "a", value: 10}, {name: "Beta", category: "b", value: 30}, {name: "Gamma", category: "a", value: 20}]
filtered = $category == "all" ? rows : @Filter(rows, "category", "==", $category)
sorted = @Sort(filtered, "value", $order)
table = Table([Col("名称", sorted.name), Col("数值", sorted.value, "number")])
```

## Cards and details

```text
root = Stack([cards, steps])
cards = Stack([first, second], "row", "m", "stretch", "start", true)
first = Card([CardHeader("方案 A", "较低成本"), TextContent("适合需求稳定的场景。")])
second = Card([CardHeader("方案 B", "较高弹性"), TextContent("适合负载波动明显的场景。")])
steps = Steps([StepsItem("确认范围", "先明确要解释的问题。"), StepsItem("比较方案", "展示相同口径的数据。"), StepsItem("得出结论", "说明影响选择的关键因素。")])
```
