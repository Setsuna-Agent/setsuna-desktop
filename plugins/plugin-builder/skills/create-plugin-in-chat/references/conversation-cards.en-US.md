# Conversation cards

Declare card metadata and a side-effect-free static example in the manifest. Plugin details list it under “Interface” and preview it in the same sandbox. Actual runtime source still comes from the tool result; do not put network or host operations in `preview`:

```json
{
  "tools": [
    { "name": "get_weather", "description": "Look up current weather at the requested location and return a weather card." }
  ],
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["tools", "ui", "network"],
    "uiCards": [
      {
        "id": "weather.current",
        "label": "Current Weather Card",
        "description": "Show current weather and a short forecast in the conversation.",
        "toolName": "get_weather",
        "preview": {
          "html": "<main id=\"weather\"></main>",
          "css": "html,body{margin:0;background:transparent}.card{padding:16px;border:1px solid var(--setsuna-color-border);border-radius:10px;color:var(--setsuna-color-text);background:var(--setsuna-color-surface);font:14px/1.5 var(--setsuna-font-family)}.temp{font-size:28px;font-weight:600}",
          "js": "window.setsunaUI.ready.then(({data})=>{document.querySelector('#weather').innerHTML=`<section class=\"card\"><div>${data.city} · ${data.condition}</div><div class=\"temp\">${data.temperature}°C</div></section>`})",
          "data": { "city": "Hangzhou", "condition": "Sunny", "temperature": 28 }
        }
      }
    ]
  }
}
```

When returning a card, put the normal text summary in `content` and the card in `data`. Do not supply `pluginId`; the host stamps the actual tool origin:

```js
return {
  content: 'Sunny in Hangzhou today, 28°C.',
  data: {
    resultKind: 'plugin.ui-card',
    resultMajor: 1,
    payload: {
      id: 'weather.hangzhou.today',
      title: 'Hangzhou Weather',
      html: '<main id="weather"></main>',
      css: '#weather { padding: 20px; border-radius: 18px; }',
      js: 'window.setsunaUI.ready.then(({data}) => { document.querySelector("#weather").textContent = `${data.temperature}°C`; });',
      data: { temperature: 28, condition: 'Sunny' },
      permissions: { network: true, hostActions: [] }
    }
  }
};
```

Card JavaScript can modify only its own sandbox DOM and read this tool result through `window.setsunaUI.ready`. The card is anchored at the tool call's persisted timeline position, naturally producing text → card → text around the tool call. Do not fake placeholders in Markdown. v1 cards cannot invoke host actions; provide a standalone page for refresh, configuration, or persistent state. A weather tool should say when to call it in its description, fetch data through allowlisted worker networking, and return both results and the card. Cards may also access the network subject to normal browser CORS.

For collecting release artifacts from conversation, subscribe to `tool.after` or `turn.settled` via `events`, extract explicit artifact fields, deduplicate, and save a bounded summary in `global` or `project` state. Do not store entire conversations or unbounded tool results.
