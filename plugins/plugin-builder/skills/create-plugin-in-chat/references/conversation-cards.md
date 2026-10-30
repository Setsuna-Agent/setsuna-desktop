# 对话交互卡片

先在 manifest 中声明卡片目录信息和一份无副作用的静态示例；插件详情页会把它列在“界面”并在同一安全沙箱中提供预览。真实运行时源码仍由工具结果返回，不要把联网或宿主操作放进 `preview`：

```json
{
  "tools": [
    { "name": "get_weather", "description": "查询用户指定地点的实时天气并返回天气卡片。" }
  ],
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["tools", "ui", "network"],
    "uiCards": [
      {
        "id": "weather.current",
        "label": "实时天气卡片",
        "description": "在对话中展示当前天气和短期预报。",
        "toolName": "get_weather",
        "preview": {
          "html": "<main id=\"weather\"></main>",
          "css": "html,body{margin:0;background:transparent}.card{padding:16px;border:1px solid var(--setsuna-color-border);border-radius:10px;color:var(--setsuna-color-text);background:var(--setsuna-color-surface);font:14px/1.5 var(--setsuna-font-family)}.temp{font-size:28px;font-weight:600}",
          "js": "window.setsunaUI.ready.then(({data})=>{document.querySelector('#weather').innerHTML=`<section class=\"card\"><div>${data.city} · ${data.condition}</div><div class=\"temp\">${data.temperature}°C</div></section>`})",
          "data": { "city": "杭州", "condition": "晴", "temperature": 28 }
        }
      }
    ]
  }
}
```

工具返回卡片时，把正常文本摘要放在 `content`，把卡片放在 `data`。不要填写 `pluginId`，宿主会用真实工具来源盖章：

```js
return {
  content: '杭州今天晴，28°C。',
  data: {
    resultKind: 'plugin.ui-card',
    resultMajor: 1,
    payload: {
      id: 'weather.hangzhou.today',
      title: '杭州天气',
      html: '<main id="weather"></main>',
      css: '#weather { padding: 20px; border-radius: 18px; }',
      js: 'window.setsunaUI.ready.then(({data}) => { document.querySelector("#weather").textContent = `${data.temperature}°C`; });',
      data: { temperature: 28, condition: '晴' },
      permissions: { network: true, hostActions: [] }
    }
  }
};
```

卡片 JavaScript 也只能在沙箱内操作自己的 DOM，并从 `window.setsunaUI.ready` 读取这次工具结果。卡片会锚定在该工具调用的持久化时间线位置；模型在调用工具前输出的介绍和拿到结果后的后续回答会自然形成 `文字 → 卡片 → 文字`，不要在 Markdown 中伪造占位标签。v1 卡片不允许 host action；需要刷新、配置或长期状态时同时提供上面的独立页面。天气类插件应把“当用户询问某地当前天气时调用”写进工具 description，由工具在 worker 中通过 allowlist 网络查询，再把结果数据和卡片一起返回；卡片也可以遵循 CORS 直接联网。

对“汇总对话中的发布产物”这类需求，使用 `events` 订阅 `tool.after` 或 `turn.settled`，从事件 payload 中提取明确的产物字段，再将去重后的有界摘要写入 `global` 或 `project` 状态；不要保存整段对话或未经约束的工具结果。
