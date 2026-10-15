# OpenUI presentation components

React apps can use the same OpenUI components as chat display blocks. Import components from `@openuidev/react-ui`; `@setsuna/app/openui` supplies the shared theme adapter. Use charts, cards, filters and view switches where needed. Preserve existing designs and continue using `@setsuna/app` for ordinary buttons, forms and business actions.

## Setup and dependencies

Merge these dependencies into the app project's `package.json`. The host supplies the SDK; do not declare workspace package paths.

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

These versions match the host chat renderer and include upstream peer dependencies. Install them through the existing `configure_plugin` installation/update flow, without separate install commands, CDN scripts, dev servers or custom Vite configuration.

Import `OpenUiProvider` from `@setsuna/app/openui` and wrap the page or shared app layout once. It loads component CSS, subscribes to the host's light/dark mode and shares chat's font, color and radius mappings. Theme changes preserve the mounted page and its filter state. Do not also import the global reset from `@openuidev/react-ui/index.css`, or copy the host chat's portal zoom compensation into the app; independent pages have their own coordinate system.

## Available components

Use upstream React props and types directly. Chat DSL positional arguments and descriptive nodes such as `Series` are not React props.

| Purpose | Components |
| --- | --- |
| Charts | `BarChart`, `HorizontalBarChart`, `LineChart`, `AreaChart`, `PieChart`, `RadarChart`, `RadialChart`, `ScatterChart`, `HeatmapChart`, `FunnelChart` |
| Compact charts | `BarChartCondensed`, `LineChartCondensed`, `AreaChartCondensed`, `MiniBarChart`, `MiniLineChart`, `MiniAreaChart`, `SegmentedBar`, `CalendarHeatmap` |
| Filters and selection | `Chips`, `OptionCards`, `Select` / `SelectTrigger` / `SelectValue` / `SelectContent` / `SelectItem`, `DatePicker`, `Calendar`, `Slider` |
| Cards and content | `Card`, `CardHeader`, `MetricIndicator`, `Tag`, `TagBlock`, `TextContent`, `TextCallout`, `Image`, `ImageGallery`, `ListBlock`, `ListItem` |
| Organization and navigation | `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent`, `Accordion` / `AccordionItem` / `AccordionTrigger` / `AccordionContent`, `Carousel` / `CarouselContent` / `CarouselItem` / `CarouselPrevious` / `CarouselNext`, `Separator` |
| Tables | `Table` / `TableHeader` / `TableBody` / `TableRow` / `TableHead` / `TableCell` are JSX containers. The `@setsuna/app` Table retains its `rows` / `columns` API; use import aliases to distinguish them. |

`Chips.items` is `{value,label,icon?,disabled?}[]`; `selected` is always a string array, `type` is `single` or `multiple`, and the app updates state in `onToggle(value)`. `OptionCards` follows the same selection API with `{value,title,subtitle?,topContent?}[]` items. For multiple selection, add or remove the toggled value from the current array.

Bar, line and area chart `data` is an array of plain objects. `categoryKey` names the category; other numeric fields become series. Project out IDs, sort keys and numbers that should not be plotted. Pie charts also require `dataKey`; `variant="donut"` selects a donut. Width follows the parent container and `height` can be explicit. Read business data through the existing `useAppData` / runtime bridge; charts display the supplied values.

## Local filters and chart switching

This page reads `series` from application state. Adapt its data shape and controls to the user's actual requirements without writing sample records into state. Filtering and chart switching only update local React state.

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
    <Chips aria-label="Time range" type="single"
      items={[{ value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }]}
      selected={[period]} onToggle={setPeriod} />
    <OptionCards aria-label="Chart type" type="single"
      items={[{ value: 'bar', title: 'Bar chart' }, { value: 'line', title: 'Line chart' }]}
      selected={[chart]} onToggle={setChart} />
    {chart === 'bar'
      ? <BarChart data={data} categoryKey="name" height={280} />
      : <LineChart data={data} categoryKey="name" height={280} />}
  </AppLayout></OpenUiProvider>;
}
```

OpenUI does not automatically call the Agent or write business data. User-requested business actions still use the existing `@setsuna/app` bridge, action allowlist and worker. Do not add an OpenUI chat backend, `Query` / `Mutation` or a second storage system.
