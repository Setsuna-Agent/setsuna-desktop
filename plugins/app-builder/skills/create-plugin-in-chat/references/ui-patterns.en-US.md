# App UI patterns

Use these fragments with the `ui-base` CSS and adopt only what the request needs. Replace titles, fields, and data sources and wire real interactions; do not combine all examples into one page or retain inert buttons. Deliver HTML, CSS, and JS through the app's own `htmlResourceId`, `cssResourceId`, and `jsResourceId`, without relative script/link tags.

## Page and toolbar

```html
<main class="sa-app">
  <header class="sa-page-header">
    <h1 class="sa-title">Records</h1>
    <div class="sa-toolbar">
      <button type="button" class="sa-button sa-button--primary" id="add-record">
        <svg class="sa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        Add
      </button>
    </div>
  </header>
  <!-- Place the relevant table, form, or chart here without another outer frame. -->
</main>
```

## Table

Build rows from actual data and insert strings with `textContent`, not unescaped HTML. Insert a `.sa-empty` cell with the correct `colspan` only when results are empty. Apply `.sa-numeric` to both the numeric heading and cells, and `.sa-wrap` only to long-text columns.

```html
<div class="sa-table-wrap">
  <table class="sa-table" aria-label="Records">
    <thead><tr><th scope="col">Name</th><th scope="col" class="sa-numeric">Amount (CNY)</th></tr></thead>
    <tbody id="record-rows"></tbody>
  </table>
</div>
```

For a fixed header and internally scrolling content, add app rules such as `.sa-app {height:100%;min-height:0}` and `.sa-table-wrap {flex:1;min-height:0}`. Do not put competing scrollbars on every panel and the page.

## Form

Place labels above controls and keep the save action content-sized. Start with one column; use `.sa-grid` only for fields that benefit from side-by-side editing. Show custom errors after validation/save failures, linking `aria-invalid` fields to the error through `aria-describedby`.

```html
<form id="record-form" class="sa-stack">
  <label class="sa-field">
    <span class="sa-label">Name</span>
    <input class="sa-input" name="name" required maxlength="120">
  </label>
  <label class="sa-field">
    <span class="sa-label">Amount (CNY)</span>
    <input class="sa-input" name="amount" type="number" required min="0" step="0.01">
  </label>
  <p id="save-error" class="sa-error" role="alert" hidden></p>
  <div class="sa-toolbar">
    <button id="save-record" type="button" class="sa-button sa-button--primary">Save</button>
  </div>
</form>
```

Native form submission is blocked by the sandbox. The save handler calls `form.reportValidity()`, reads `FormData`, validates, then calls a declared `setsunaUI.invoke` action. Prevent native submit; route Enter through the same save function when supported. Disable save while pending, keep drafts on failure, and do not rebuild forms on theme snapshots.

## ECharts

Declare `document.libraries: ['echarts']` and add `<div id="chart" class="sa-chart" role="img" aria-label="Amount chart"></div>`. Adapt `data.rows`, `name`, and `amount` to actual data/dimensions. For backend API data, retain the data model in page state; theme notifications redraw it without refetching the entire history.

```js
(async () => {
  const initial = await window.setsunaUI.ready;
  const container = document.querySelector('#chart');
  const chart = window.echarts.init(container, null, { renderer: 'svg' });
  const render = ({ data }) => {
    const styles = getComputedStyle(document.documentElement);
    const color = (name) => styles.getPropertyValue(`--setsuna-color-${name}`).trim();
    const rows = data.rows ?? [];
    chart.setOption({
      backgroundColor: 'transparent',
      color: [color('accent')],
      animation: false,
      textStyle: { fontFamily: styles.getPropertyValue('--setsuna-font-family').trim(), fontSize: 12, color: color('text') },
      grid: { top: 16, right: 16, bottom: 12, left: 12, containLabel: true },
      tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: color('surface'), borderColor: color('border'), textStyle: { color: color('text') } },
      xAxis: {
        type: 'category', data: rows.map((row) => row.name),
        axisTick: { show: false }, axisLabel: { color: color('text-muted') },
        axisLine: { lineStyle: { color: color('border') } },
      },
      yAxis: {
        type: 'value', axisLabel: { color: color('text-muted') }, axisLine: { show: false },
        splitLine: { lineStyle: { color: color('border') } },
      },
      series: [{ id: 'amount', name: 'Amount (CNY)', type: 'bar', barMaxWidth: 28, data: rows.map((row) => row.amount) }],
    });
  };
  render(initial);
  const unsubscribe = window.setsunaUI.subscribe(render);
  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(container);
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    unsubscribe();
    chart.dispose();
  }, { once: true });
})().catch((error) => {
  const message = document.createElement('p');
  message.className = 'sa-error';
  message.setAttribute('role', 'alert');
  message.textContent = error.message;
  document.querySelector('#chart').replaceChildren(message);
});
```

This is a single-series baseline. For multiple series, keep colors stable by series ID. The host blue/cyan/purple/teal palette is `#5b83e8, #31a6bc, #9a75dc, #36a89b` in light mode and `#86aaff, #73cede, #bd9cf1, #75d4c2` in dark mode; choose from the root element's current `colorScheme`. Theme legend text as well; do not convey meaning through color alone. Show actual empty states instead of fabricated chart data.
