# OpenUI 展示组件

React 应用可以使用与聊天展示块同源的 OpenUI 组件。组件从 `@openuidev/react-ui` 导入，SDK 的 `@setsuna/app/openui` 提供主题适配。按需采用图表、卡片、筛选和切换控件；已有页面保留其设计，普通按钮、表单和业务操作继续复用 `@setsuna/app`。

## 接入与依赖

在应用项目的 `package.json` 中合并以下依赖。SDK 本身由宿主注入，不要把工作区包路径写入依赖。

```json
{
  "dependencies": {
    "@openuidev/react-ui": "0.18.1",
    "@openuidev/react-headless": "0.18.1",
    "@openuidev/react-lang": "1.0.1",
    "zod": "4.6.7",
    "zustand": "4.5.7"
  }
}
```

这些版本与宿主聊天组件一致，包含上游要求的 peer dependencies。通过原有 `configure_plugin` 安装或更新流程获取依赖，不运行额外安装命令、CDN script、开发服务器或自定义 Vite 配置。

从 `@setsuna/app/openui` 导入 `OpenUiProvider`，在页面或共用应用布局外层包裹一次。它自动加载组件 CSS，订阅宿主的深浅主题，并复用聊天的字体、色彩和圆角映射。主题变化不会重挂载页面或清空筛选状态。不要再导入带全局 reset 的 `@openuidev/react-ui/index.css`，也不要把宿主聊天浮层的 zoom 补偿复制进应用；独立页面使用自己的坐标系。

## 可用组件

直接使用上游 React API 与类型，不把聊天 DSL 的位置参数或 `Series` 等描述节点当成 React props。

| 用途 | 组件 |
| --- | --- |
| 图表 | `BarChart`、`HorizontalBarChart`、`LineChart`、`AreaChart`、`PieChart`、`RadarChart`、`RadialChart`、`ScatterChart`、`HeatmapChart`、`FunnelChart` |
| 紧凑图表 | `BarChartCondensed`、`LineChartCondensed`、`AreaChartCondensed`、`MiniBarChart`、`MiniLineChart`、`MiniAreaChart`、`SegmentedBar`、`CalendarHeatmap` |
| 筛选与选择 | `Chips`、`OptionCards`、`Select` / `SelectTrigger` / `SelectValue` / `SelectContent` / `SelectItem`、`DatePicker`、`Calendar`、`Slider` |
| 卡片与内容 | `Card`、`CardHeader`、`MetricIndicator`、`Tag`、`TagBlock`、`TextContent`、`TextCallout`、`Image`、`ImageGallery`、`ListBlock`、`ListItem` |
| 组织与导航 | `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent`、`Accordion` / `AccordionItem` / `AccordionTrigger` / `AccordionContent`、`Carousel` / `CarouselContent` / `CarouselItem` / `CarouselPrevious` / `CarouselNext`、`Separator` |
| 表格 | `Table` / `TableHeader` / `TableBody` / `TableRow` / `TableHead` / `TableCell`；它们是 JSX 容器。`@setsuna/app` 的 `Table` 仍使用 `rows` / `columns` API，可通过导入别名区分。 |

`Chips` 的 `items` 是 `{value,label,icon?,disabled?}[]`，`selected` 始终是字符串数组，`type` 为 `single` 或 `multiple`，`onToggle(value)` 由应用更新状态。`OptionCards` 类似，但内容使用 `{value,title,subtitle?,topContent?}[]`。多选时按当前数组增删值，不直接把回调值当作整组选项。

柱状、折线和面积图的 `data` 是普通对象数组，`categoryKey` 指定分类字段，其余数值字段是数据系列；先投影掉 ID、排序值等不应绘制的数值字段。饼图另需 `dataKey`，`variant="donut"` 表示环形。宽度由父容器决定，可显式设置 `height`。业务数据使用已有 `useAppData` / runtime bridge；组件只展示传入的数据。

## 本地筛选与图表切换示例

下面页面从应用状态的 `series` 读取记录；替换为用户实际数据结构和需要的控件，不向状态写入演示记录。筛选和图表切换只更新 React 本地状态。

```tsx
import { useState } from 'react';
import { AppLayout, useAppData } from '@setsuna/app';
import { OpenUiProvider } from '@setsuna/app/openui';
import { BarChart, LineChart, Chips, OptionCards } from '@openuidev/react-ui';

type View = { series?: { period: string; name: string; amount: number }[] };

export default function Overview() {
  const { series = [] } = useAppData<View>();
  const [period, setPeriod] = useState('week');
  const [chart, setChart] = useState('bar');
  const data = series.filter(row => row.period === period)
    .map(row => ({ name: row.name, amount: row.amount }));

  return <OpenUiProvider><AppLayout>
    <Chips aria-label="时间范围" type="single"
      items={[{ value: 'week', label: '本周' }, { value: 'month', label: '本月' }]}
      selected={[period]} onToggle={setPeriod} />
    <OptionCards aria-label="图表类型" type="single"
      items={[{ value: 'bar', title: '柱状图' }, { value: 'line', title: '折线图' }]}
      selected={[chart]} onToggle={setChart} />
    {chart === 'bar'
      ? <BarChart data={data} categoryKey="name" height={280} />
      : <LineChart data={data} categoryKey="name" height={280} />}
  </AppLayout></OpenUiProvider>;
}
```

OpenUI 不自动执行 Agent 回调或业务写入。页面确有用户要求的业务操作时，仍使用现有 `@setsuna/app` bridge、action allowlist 和 worker；不要添加 OpenUI 的聊天后端、`Query` / `Mutation` 或第二套存储。
