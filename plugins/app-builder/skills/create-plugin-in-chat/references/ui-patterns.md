# 应用界面模板

以下片段配合 `ui-base` CSS 使用，只摘取当前需求需要的部分。替换标题、字段和数据源，绑定真实交互；不要把所有示例拼成一页，也不要保留未实现的按钮。HTML 放入自己的 `htmlResourceId`，CSS 放入 `cssResourceId`，JavaScript 放入 `jsResourceId`，不要添加相对路径的 script/link 标签。

## 页面与工具栏

```html
<main class="sa-app">
  <header class="sa-page-header">
    <h1 class="sa-title">记录</h1>
    <div class="sa-toolbar">
      <button type="button" class="sa-button sa-button--primary" id="add-record">
        <svg class="sa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        新增
      </button>
    </div>
  </header>
  <!-- 在这里放需要的表格、表单或图表；不再套一个同样的外框。 -->
</main>
```

## 表格

表格行从真实数据生成，字符串用 `textContent` 写入；不要将用户输入插入未转义的 HTML。只在结果为空时插入 `.sa-empty` 单元格并设置正确 `colspan`。数值列的表头和内容都使用 `.sa-numeric`；只有长文本列使用 `.sa-wrap`。

```html
<div class="sa-table-wrap">
  <table class="sa-table" aria-label="记录">
    <thead><tr><th scope="col">名称</th><th scope="col" class="sa-numeric">金额（元）</th></tr></thead>
    <tbody id="record-rows"></tbody>
  </table>
</div>
```

应用需要固定标题与内部滚动时，在自己的 CSS 中设置布局，例如 `.sa-app {height:100%;min-height:0}`、`.sa-table-wrap {flex:1;min-height:0}`。不要同时给页面和每层面板添加滚动条。

## 表单

标签在控件上方，保存按钮保持内容宽度。默认用单列；真实字段较多且适合并排时才使用 `.sa-grid`。自定义错误只在校验或保存失败后显示；将对应字段 `aria-invalid` 与错误 `aria-describedby` 关联。

```html
<form id="record-form" class="sa-stack">
  <label class="sa-field">
    <span class="sa-label">名称</span>
    <input class="sa-input" name="name" required maxlength="120">
  </label>
  <label class="sa-field">
    <span class="sa-label">金额（元）</span>
    <input class="sa-input" name="amount" type="number" required min="0" step="0.01">
  </label>
  <p id="save-error" class="sa-error" role="alert" hidden></p>
  <div class="sa-toolbar">
    <button id="save-record" type="button" class="sa-button sa-button--primary">保存</button>
  </div>
</form>
```

沙箱禁止原生表单提交。保存按钮的 handler 先调用 `form.reportValidity()`，再读取 `FormData`、校验并调用已声明的 `setsunaUI.invoke`。阻止 form 的原生 submit，需要支持回车时走同一保存函数。pending 时禁用保存按钮，错误时保留草稿，不因主题快照重建表单。

## ECharts

声明 `document.libraries: ['echarts']`，加入 `<div id="chart" class="sa-chart" role="img" aria-label="金额图表"></div>`。按真实数据与维度替换下面的 `data.rows`、`name`、`amount`。后端 API 数据应存于页面自己的数据模型，主题回调只重绘当前数据，不重新请求全量历史。

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
      series: [{ id: 'amount', name: '金额（元）', type: 'bar', barMaxWidth: 28, data: rows.map((row) => row.amount) }],
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

这是一条序列的基准。多序列按系列 ID 保持配色稳定，可参考宿主的蓝/青/紫/青绿配色：亮色 `#5b83e8, #31a6bc, #9a75dc, #36a89b`，深色 `#86aaff, #73cede, #bd9cf1, #75d4c2`；读取当前根元素 `colorScheme` 选择。图例文字也使用主题文字色；不要仅靠颜色传递数据含义。无数据时显示真实空状态，不绘制演示数据。
