---
name: "Create Plugin in Chat"
description: "Create or update a Setsuna Plugin Bundle through conversation. Generate a complete manifest and UTF-8 file snapshot, then call configure_plugin. Use when the user asks to create, modify, or save a desktop plugin containing Skills, MCP servers, Hooks, resources, or executable extensions."
---

# Create Plugin in Chat

The capability page's “Create plugin in chat” action selects this Skill. Generate a complete Plugin Bundle from the request and install it with `configure_plugin`. Do not ask for an unpacked directory or write to private runtime directories.

## Choose the capability

- For model instructions or workflows, use `skills/<name>/SKILL.md` and declare the directory in manifest `skills`.
- For external services, use `mcpServers`; never embed API keys, fixed secrets, authentication headers, or credential-bearing URLs.
- For local commands around the Agent lifecycle, use `hooks` and reference bundled scripts through `{{pluginRoot}}`.
- For dynamic tools, lifecycle events, state, or structured user questions, use `extension`.
- For sidebar entries or standalone pages, use Renderer UI v2 in `extension.rendererUi`. Use host-rendered `tree` for simple forms and status, or a sandboxed HTML/CSS/JS `document` for custom layout and interaction.
- For interactive cards after a tool runs, declare the card name, tool, and static sandbox preview in `extension.uiCards`, then return `plugin.ui-card@1` from the tool. One Plugin can provide both cards and persistent sidebar pages.
- `tools` is display metadata and does not register executable tools; use `api.registerTool` in the extension.
- `resources` declares Agent-readable resources and the HTML/CSS/JS files referenced by sandboxed pages.

## Bundle rules

Submit a complete snapshot to `configure_plugin`:

- `manifest` must include at least a stable lowercase `id` and user-facing `name`; use Bundle v2 fields.
- `files` includes every UTF-8 text file except `.setsuna-plugin/plugin.json`. Updating removes files omitted from the new snapshot.
- The limit is 64 text files and 512 KiB in total. This tool cannot create binary assets such as images.
- Every Skill directory must contain a complete `SKILL.md`, without TODOs, placeholders, or omitted content.
- Hook commands should reference bundled scripts; provide `commandWindows` when needed.
- The extension entry must be a bundled `.mjs`, using `apiVersion: 1`, `runtime: node-worker`, and only the capabilities actually used: `tools`, `events`, `state`, `ui`, `network`.
- `rendererUi`, `uiCards`, and `plugin.ui-card` require `ui`. Put `uiCards` only at `manifest.extension.uiCards`, never at the manifest root. Each `uiCards[].toolName` must match a top-level `tools` entry. Each preview must contain static offline HTML/JS and bounded example data; it neither executes the tool nor replaces the real card source returned on each call. Data or state bindings also require `state`. Do not generate React bundles, remote iframes, or access the host DOM.
- Do not declare `image-generation` or `vision-recognition`; these private host bridges are reserved for the bundled marketplace and cannot be installed in local or chat-created plugins.
- `network` requires exact HTTP(S) origins without paths or credentials in `extension.network.allowedOrigins`. Call `context.network.request(...)` on the handler's second argument to use app proxying, cancellation, timeouts, and response-size limits. `response.body` is always a string: check `response.ok`/`response.status`, then use `await response.json()` or `JSON.parse(response.body)` before accessing fields. There is no `api.network`.
- v1 runs no install scripts or package managers. Include dependencies in the Bundle text files.
- Before calling, verify `extension.entry`, all `resources[].path` values, every Skill's `SKILL.md`, and every `{{pluginRoot}}` reference exist in this same complete `files` snapshot. Do not probe validation one error at a time with incomplete snapshots.

Minimal dynamic tool entry:

```js
export default function activate(api) {
  api.registerTool({
    name: 'example',
    description: 'Explain exactly when the model should call this tool.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    async execute(input) {
      return { content: String(input.value) };
    },
  });
}
```

## Extension API contract

Distinguish registration APIs from execution context. `activate(api)` provides **only**:

- `api.registerTool(definition)` to register tools.
- `api.on(eventName, handler)` for `session.start`, `prompt.before`, `tool.before`, `tool.after`, `compact.before`, and `turn.settled`. There is no `api.onEvent`.
- `api.onUiAction(actionId, handler)` to register Renderer UI actions.

Network, state, interactive UI, and cancellation are on the handler's second argument, `context`. Do not use `api.network`, `api.state`, or `api.ui`:

```js
api.registerTool({
  name: 'get_weather',
  description: 'Call when the user asks for current weather at a location and return a weather card.',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
  async execute(input, context) {
    const response = await context.network.request({
      url: `https://api.example.com/weather?city=${encodeURIComponent(input.city)}`,
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Weather API failed: HTTP ${response.status}`);
    const weather = await response.json();
    if (!weather || typeof weather !== 'object') throw new Error('Weather API returned invalid JSON.');
    return { content: `${input.city}：${weather.temperature}°C` };
  },
});
```

Handler capabilities:

- Tool: `async execute(input, context)`; declared capabilities provide `context.network`, `context.state`, and `context.ui`, and `context.signal` is always available.
- Event: `api.on(name, async (payload, context) => ...)`; the first argument is event data, not necessarily tool input.
- UI Action: `api.onUiAction(id, async (input, context) => ...)`; form values are in `input.values`, page arguments in `input.payload`. Interactive `context.ui` is unavailable here.
- State: `context.state.get(key, scope?)`, `set(key, value, scope?)`, `delete(key, scope?)`. Tool/Event default to `thread`; UI Action uses the contribution's `data.scope`. Explicitly use the matching `global`/`project`/`thread` scope when sharing sidebar state across entry points.
- Network response: `{ ok, status, statusText, headers, body, text(), json() }`. `body` is UTF-8 text, not an object; do not use `response.body.current`.

Declare only supported events with verified behavior. Do not add nonessential automatic synchronization just for completeness; incorrect events and unverified payload assumptions reduce reliability.

## Renderer UI

Renderer UI v2 supports these controlled slots:

- `renderer.plugin.page`: standalone page, with a sidebar entry generated from `navigation.label`.
- `renderer.settings.page.extensions`: allowed extension settings sections, currently targeting `general` or `about`.
- `renderer.chat.composer.status`: compact composer status using only `stack`, `text`, `badge`, `notice`, and `button`.

A `tree` page supports `stack`, `text`, `badge`, `notice`, `field`, `select`, and `button`. Dynamic text and form defaults use `{ "path": "summary.label", "fallback": "Not run yet" }`, resolved only against the state object at the contribution's `data.stateKey`. `data.scope` must be `global`, `project`, or `thread`. Sidebar entries remain visible; the host displays a notice when context is missing. Settings data must use `global`; chat status may use `global` or `thread`.

Place `stateKey` and `scope` inside the contribution's `data` object, not at the contribution root.

Core manifest structure for a release checker:

```json
{
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["ui", "state"],
    "rendererUi": {
      "schemaVersion": 2,
      "actions": [
        {
          "id": "release.run",
          "approval": { "title": "Run release checks", "message": "Run the configured checks in the current project." }
        }
      ],
      "contributions": [
        {
          "id": "release.page",
          "slot": "renderer.plugin.page",
          "navigation": {
            "label": "Release Checker",
            "badge": { "path": "summary.label", "fallback": "Not run" }
          },
          "data": { "stateKey": "release.view", "scope": "project" },
          "tree": {
            "type": "stack",
            "children": [
              {
                "type": "notice",
                "title": "Latest result",
                "text": { "path": "summary.detail", "fallback": "Run checks to generate a result." }
              },
              {
                "type": "field",
                "name": "command",
                "label": "Check command",
                "defaultValue": { "path": "config.command", "fallback": "pnpm test" },
                "required": true
              },
              { "type": "button", "actionId": "release.run", "label": "Run checks", "variant": "primary" }
            ]
          }
        }
      ]
    }
  }
}
```

Register the handler with the same action ID and write the complete view model to the declared state key. For UI actions the host locks `ctx.state` to the contribution's `data.scope`; the plugin cannot write across scopes:

```js
export default function activate(api) {
  api.onUiAction('release.run', async (input, context) => {
    const command = String(input.values.command);
    // Perform the actual checks here and always write a bounded, JSON-serializable view model.
    await context.state.set('release.view', {
      config: { command },
      summary: { label: 'Completed', detail: 'All release checks passed.' },
    });
  });
}
```

### Custom standalone pages

For dashboards, charts, complex layouts, or custom interaction, use `document` instead of `tree` in a `renderer.plugin.page` contribution. Submit HTML/CSS/JS as Bundle text files and declare them in `resources`:

```json
{
  "resources": [
    { "id": "weather-html", "path": "ui/weather.html" },
    { "id": "weather-css", "path": "ui/weather.css" },
    { "id": "weather-js", "path": "ui/weather.js" }
  ],
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["ui", "state", "network"],
    "network": { "allowedOrigins": ["https://api.open-meteo.com", "https://geocoding-api.open-meteo.com"] },
    "rendererUi": {
      "schemaVersion": 2,
      "actions": [
        { "id": "weather.refresh", "approval": { "message": "Refresh weather over the network?" } }
      ],
      "contributions": [
        {
          "id": "weather.page",
          "slot": "renderer.plugin.page",
          "navigation": { "label": "Weather" },
          "data": { "stateKey": "weather.view", "scope": "global" },
          "document": {
            "htmlResourceId": "weather-html",
            "cssResourceId": "weather-css",
            "jsResourceId": "weather-js",
            "actionIds": ["weather.refresh"]
          }
        }
      ]
    }
  }
}
```

Page scripts use only the frozen narrow bridge at `window.setsunaUI`:

```js
const first = await window.setsunaUI.ready;
render(first.data);
window.setsunaUI.subscribe(({ data }) => render(data));
await window.setsunaUI.invoke('weather.refresh', { city: 'Hangzhou' });
```

Pages run in an opaque-origin sandbox iframe. They cannot directly fetch, read files, access Node/Electron/preload, open windows, download, submit forms, or navigate. Put network and project operations in worker actions using `ctx.network.request(...)` or approved host capabilities. `input.payload` is bounded JSON from the page.

### Conversation cards

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
          "css": "html,body{margin:0;background:transparent}.card{padding:20px;border-radius:18px;color:#fff;background:#28506b;font:14px system-ui}.temp{font-size:48px;font-weight:700}",
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
      permissions: { network: false, hostActions: [] }
    }
  }
};
```

Card JavaScript can modify only its own sandbox DOM and read this tool result through `window.setsunaUI.ready`. The card is anchored at the tool call's persisted timeline position, naturally producing text → card → text around the tool call. Do not fake placeholders in Markdown. v1 cards cannot invoke host actions; provide a standalone page for refresh, configuration, or persistent state. A weather tool should say when to call it in its description, fetch data through allowlisted worker networking, and return both results and the card. The card itself must not access the network.

For collecting release artifacts from conversation, subscribe to `tool.after` or `turn.settled` via `events`, extract explicit artifact fields, deduplicate, and save a bounded summary in `global` or `project` state. Do not store entire conversations or unbounded tool results.

## Workflow

1. Determine whether this is creation or update; infer the plugin ID, name, and capabilities from the request.
2. Ask only for core behavior, external service details, or platform requirements that cannot safely be inferred. Create directly when requirements are clear.
3. Generate the complete manifest and all text files. Do not call `install_plugin_bundle` or require a local directory.
4. Call `configure_plugin`. Before approval, briefly describe the Skills, MCP servers, Hooks, resources, and extension to install, including whether it contains executable code.
5. If preflight fails, fix every listed field and file and submit a new complete snapshot. Do not end the turn with promises to finish later.
6. `Installed and enabled: true` confirms only manifest, syntax, and worker activation. For extensions with tools or UI actions, immediately call `verify_plugin` using representative, read-only inputs covering every user-facing execution path. Tools declaring `uiCards` are required to return a valid `plugin.ui-card`.
7. For UI actions, provide `contributionId` and verify required view state with `expectStatePaths`, such as `summary.label`. External writes must use the plugin's dry-run; if no safe test is available, obtain explicit user authorization. Never use a real destructive operation as a test.
8. Report an executable plugin as usable only after `verify_plugin` returns `Verified and usable: true`. On failure, repair the complete snapshot using the failing check, call `configure_plugin` again, and verify again. Do not equate installation with verified usability.
9. Updates also require complete snapshots. The tool rejects overwriting an identically named plugin from the built-in marketplace or another directory; explain the conflict instead of modifying its source.

If a weather plugin provides both a conversation card and sidebar refresh, verify both real paths after installation:

```json
{
  "pluginId": "hangzhou-weather",
  "checks": [
    {
      "kind": "tool",
      "name": "get_weather",
      "input": { "city": "Hangzhou" },
      "expectUiCard": true
    },
    {
      "kind": "ui-action",
      "name": "weather.refresh",
      "contributionId": "weather.page",
      "values": {},
      "payload": { "city": "Hangzhou" },
      "expectStatePaths": ["summary.label"]
    }
  ]
}
```

## Safety boundaries

- Do not invent or embed credentials, or read runtime, model, or native bridge tokens through an extension.
- Executable extensions run in separate Node workers, not an OS sandbox, and retain the current user's filesystem and network permissions.
- Approval binds the current manifest, complete file contents, and hash. Approved Hooks and extensions are installed and enabled; later content changes require approval again.
- Do not use shell commands, file-writing tools, or local directories to create plugin drafts, run `node --check`, or bypass `configure_plugin` through sideloading. `configure_plugin` validates snapshot JavaScript directly and verifies staged worker activation after approval.
