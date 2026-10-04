---
name: "Create Plugin in Chat"
description: "Create or update a Setsuna Plugin Bundle from a natural-language request, including standalone apps below Plugins in the left sidebar, editable tables, forms, and ECharts views. Generate a complete manifest and UTF-8 file snapshot and call configure_plugin; also supports Skills, MCP servers, Hooks, and executable extensions."
---

# Create Plugin in Chat

This Skill ships with the default-installed App Builder plugin. The sidebar “+” and the capability page's “Create plugin in chat” action select that plugin. Shortcuts prefill a new projectless chat; wait for the user to send before acting. Generate a complete Plugin Bundle from the request and install it with `configure_plugin`. Do not ask for an unpacked directory or write to private runtime directories. Creating a sidebar app does not require a project.

## UI design resources

Before creating or changing an app UI, read this plugin's resources, then write HTML/CSS. Default to Setsuna's compact desktop style. Explicit user choices for branding, layout, or style take precedence; preserve an existing app's design when updating it.

- Read the [design guidelines](references/ui-design.en-US.md) with `read_plugin_resource({pluginId:'app-builder',resourceId:'ui-design'})` and the [base CSS](assets/ui-base.css) with `resourceId:'ui-base'`. If unavailable, find `read_plugin_resource` through `search_tools` first.
- Read the relevant [table, form, and ECharts patterns](references/ui-patterns.en-US.md) through `resourceId:'ui-patterns'`; adopt only the parts the app needs. Host-rendered `tree` pages already use system components and do not need copied CSS.
- For buttons, fields, selects, tabs, dialogs, or icons, read the [component guide](references/ui-components.en-US.md) through `resourceId:'ui-component-guide'` and reuse `ui-components` and `ui-icons`. The latter supplies 80 Lucide icons from the same source as the host; do not invent SVG paths. Include the scripts in the app's JS as documented, without React or new dependencies.
- Write the base CSS into the generated app's `ui/app.css`, append app-specific styles, and deliver it through that app's own `resources` and `document.cssResourceId`. These are authoring resources, not cross-plugin runtime imports. Relative `<link>`, `@import`, and CDN loading do not work in the sandbox.
- The guidelines govern color, typography, spacing, alignment, and interaction states without forcing one business layout. Do not put the guidelines, sample sections, unrelated fields, or decorative data into the user's UI.

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
- For HTML/CSS/JS apps, prefer writing and editing files in the current workspace (the current temporary workspace when no project is selected), then submit `{ "path": "ui/app.html", "sourcePath": "ui/app.html" }`. `path` is the bundle destination; `sourcePath` is workspace-relative or an absolute path within approved readable roots. The host reads the original file directly; do not read back and copy all source into the call.
- Each item must provide exactly one of `sourcePath` or `content`. Small snippets may use `content` as an ordinary JSON string. Do not add XML/HTML entity escaping or Base64 encoding; preserve source entities such as `&amp;`, tags, quotes, and newlines. For `$text`, non-string content, or malformed file arrays, retry with `sourcePath` instead of repeatedly generating JSON/XML payload files, guessing ports, or searching for tokens.
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

### Reuse Setsuna backend data

Trusted sidebar apps can access `/v1/` backend APIs, including saved projects, conversations across projects, message history, tool execution records, feature operations and settings. Local plugin import at `/v1/features/plugin-management/install-local` is main-process-only and requires the native directory picker. Do not guess environment variables, read private runtime files, claim the project list is unavailable, or ask users to recreate their existing projects.

1. Before authoring, inspect `read_runtime_api({path:'/v1/runtime-api'})`, then read the real data: `/v1/projects` or `/v1/threads?scope=all&includeArchived=true`. Reuse actual project and thread IDs.
2. Pages call `window.setsunaUI.runtime.request({path,method?,body?})`; tool/event/UI action handlers call `context.runtime.request(...)`. Both return `{ok,status,data}` with parsed JSON in `data`. Check `ok` first. GET is the default; POST/PUT/PATCH/DELETE/HEAD and JSON request bodies are supported.
3. Installing and trusting the application grants this access. No extra capability, network origin, selected project or per-endpoint prompt is required. The host handles authentication; never obtain runtime tokens or call its local port directly.
4. A page displaying backend data can omit contribution `data` and use empty `actions/actionIds`. Store an app's own cross-project TODO state globally and associate it with existing project IDs; do not force a project selection with project-scoped data.
5. Page messages via `/v1/threads/:id/messages?limit=50`, passing returned `nextBefore` as `before`. Page or poll tool events via `/v1/threads/:id/event-history?sinceSeq=0&limit=100`, continuing from `nextSinceSeq` while `hasMore`. Read truncated output via `/v1/threads/:id/tool-results/:resultId?offset=0&limit=32000`, continuing from `nextOffset`. Do not copy full conversation history into bounded plugin state.
6. After installation, run a `verify_plugin` check such as `{kind:'runtime-api',name:'/v1/projects',contributionId:'app.page'}` using the app's actual GET path. Also cover all declared tools and UI actions. This verifies the data bridge, not page JavaScript or visual appearance.
7. Delete conversations through `DELETE /v1/threads/:id`. The desktop host checks unsaved changes and active saves in every window and requests confirmation when needed; deletion fails when the host is unavailable. User cancellation returns `{ok:false,status:409,data:{cancelled:true}}`; preserve current data and do not retry deletion. Never substitute the `thread/delete` RPC to bypass these checks.

```js
await window.setsunaUI.ready;
const response = await window.setsunaUI.runtime.request({ path: '/v1/threads?scope=all' });
if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.data)}`);
renderConversations(response.data.threads);
```

Each request/response is bounded to 8 MiB with a 120-second timeout; paginate large records. SSE streams use the incremental event API instead. Conversation cards and static previews cannot call the backend; use a sidebar application for persistent live data and operations.

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

For standalone apps, editable tables, forms, dashboards, charts, complex layouts, or custom interaction, use `document` instead of `tree` in a `renderer.plugin.page` contribution. The entry appears below Plugins in the left sidebar. The app fills the main area without a host title, description, card border, or width limit. Submit HTML/CSS/JS as Bundle text files and declare them in `resources`:

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
        { "id": "weather.refresh" }
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

Page scripts may use standard DOM APIs within their own document. Access host capabilities through the frozen narrow bridge at `window.setsunaUI`; frozen means its API cannot be replaced, not that the page is limited to a fixed component set:

```js
const first = await window.setsunaUI.ready;
render(first.data);
window.setsunaUI.subscribe(({ data }) => render(data));
await window.setsunaUI.invoke('weather.refresh', { city: 'Hangzhou' });
```

Pages run in an opaque-origin sandbox iframe. They cannot directly fetch, read files, access Node/Electron/preload, open windows, download, submit forms, or navigate. Put network and project operations in worker actions using `ctx.network.request(...)` or approved host capabilities. `input.payload` is bounded JSON from the page.

The host provides compatible `window.alert`, `window.confirm` and `window.prompt`, also callable without the `window.` prefix. They retain synchronous semantics: `confirm` returns true on confirmation and false on cancellation; `prompt` supports a default value and returns a string (including an empty string) on confirmation or null on cancellation; `alert` waits until dismissed. The current window's script waits for the user, so do not call them in render or refresh loops. Use the shared `SetsunaComponents.dialog` or a page-local `<dialog>` for complex forms; see `ui-component-guide`. Close after persistence succeeds, preserve input on failure, and do not mutate data on cancellation.

#### Create an app from one request

- For “make a customer table with an entry form and a sales chart”, generate one complete app with its page, interactions, and save action. Tables, forms, and charts can be combined freely; do not ask the user to choose a tech stack or write a manifest.
- Compose layout, columns, filtering, validation, and interaction for the request, reusing the design guidelines and base styles by default. Implement requested features only, without adding persistent explanations or summaries. Use `--setsuna-*` variables for the host theme. The page owns its full viewport; use `height:100%`, flex/grid, and internal scrolling as needed.
- Default to `data: { stateKey: "app.view", scope: "global" }` unless the user wants project- or conversation-specific data. Worker reads and writes must use the same key/scope. Do not persist business data in `localStorage`.
- Use stable row IDs. Keep sorting, filtering, and edit drafts in the page and submit bounded payloads with `setsunaUI.invoke`. Ordinary saves, app data updates and refreshes declare only the action `id`, omitting optional `approval`, and execute directly. Batch or debounce autosaves. Validate fields, types, record counts and data size in the worker before writing `context.state`; no per-save approval or separate storage channel is needed.
- Use `approval: { title?, message }` only for interactions needing extra confirmation, such as deletion. If the page already confirms with `confirm` or `UI.dialog`, omit action `approval` to avoid duplicate dialogs. For an existing app, remove the save action's old `approval` to save directly. This does not change installation trust, tool approvals or the host's unsaved-edit checks when deleting conversations.
- HTML form controls work; native form submission is blocked. Use a `type="button"` save button, call `reportValidity()`, and save through the bridge. Preserve drafts on failure; update tables and charts from the canonical host snapshot after success.
- Both `ready` and `subscribe` can deliver snapshots, including theme notifications. Do not recreate forms, overwrite unsaved inputs, or register duplicate handlers on every notification. Update saved-data views only when their data changes.
- Keep plugin ID, state key, scope, and record IDs stable across app updates. New fields must tolerate old records. Never replace existing data with examples. Snapshots are limited to 64 KiB and 512 data entries; design for small local apps, without promising unlimited tables.
- After installation, use `verify_plugin` for actual save/read paths without damaging data. For new apps, use only user-requested initial records. For updates, use an explicitly implemented dry-run or save the unchanged current state; never insert test records or clear existing data.

#### ECharts

Declare `"libraries": ["echarts"]` in `document` to receive offline `window.echarts` before page scripts. Generate chart options and interaction code only; do not copy ECharts source, reference a CDN, or run a package manager. Other libraries are not allowlisted. Use the themed chart in the `ui-patterns` resource: explicit container dimensions, container-based resize, colors updated on host snapshots, and unsubscribe/dispose on unload. Adapt fields, dimensions, and units to actual data; the example structure is not a backend API contract.

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
3. Generate the complete manifest and prepare all text files in the current workspace, preferring `sourcePath` for submission. Do not ask the user to prepare a local directory or call `install_plugin_bundle`.
4. Call `configure_plugin`. Before approval, briefly describe the Skills, MCP servers, Hooks, resources, and extension to install, including whether it contains executable code.
5. If preflight fails, fix every listed field and file and submit a new complete snapshot. Do not end the turn with promises to finish later.
6. `Installed and enabled: true` confirms only manifest, syntax, and worker activation. For extensions with tools or UI actions, immediately call `verify_plugin` using representative, read-only inputs covering every user-facing execution path. Tools declaring `uiCards` are required to return a valid `plugin.ui-card`.
7. For UI actions, provide `contributionId` and verify required view state with `expectStatePaths`, such as `summary.label`. External writes must use the plugin's dry-run; if no safe test is available, obtain explicit user authorization. Never use a real destructive operation as a test.
8. `verify_plugin` returning `checksPassed:true` proves only the listed host-handler or API checks. A `ui-action` check calls the worker directly without executing page JavaScript, clicking buttons or testing dialogs; `pageInteractionsVerified:false` means page interactions remain unverified. Report the actual scope, without claiming that buttons, dialogs or the entire app were verified. On failure, repair the complete snapshot, call `configure_plugin` again and recheck. Claim page behavior was verified only with separate interaction evidence; do not use a browser or computer-use without the user's authorization just to obtain it.
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
- File tools may prepare source in the current workspace, but never write private runtime draft/install directories or bypass `configure_plugin` through sideloading. The tool reads `sourcePath`, validates snapshot JavaScript, and verifies staged worker activation after approval; no separate `node --check` is needed. Source changes after approval invalidate the preview and require resubmission.
