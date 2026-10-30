---
name: create-plugin-in-chat
description: "Create or update Setsuna sidebar apps from chat, including website entries, React apps, tables, forms, and charts. Generate a complete app bundle and call configure_plugin."
---

# Create apps in chat

This Skill belongs to App Builder and creates or updates sidebar apps. The sidebar “+” starts a projectless chat with this builder; shortcuts prefill a draft and wait for the user to send it. Creating a sidebar app does not require a project. Preserve an existing app's plugin ID, page ID, and stored data when updating.

Use Plugin Builder for standalone Skills, MCP servers, Hooks, tools, or conversation cards. Add backend capabilities here only when the requested app needs them. Apps still use Plugin Bundles as their installation format.

## UI design resources

Read these resources only when creating or changing a local React or HTML/CSS/JS app UI. For a sidebar entry opening an existing website, configure `webpage.url` directly, skipping design resources, page generation and iframe embedding checks. Default to Setsuna's compact desktop style. Explicit user choices for branding, layout, or style take precedence; preserve an existing app's design when updating it.

- Read the [design guidelines](references/ui-design.en-US.md) with `read_plugin_resource({pluginId:'app-builder',resourceId:'ui-design'})` and the [base CSS](assets/ui-base.css) with `resourceId:'ui-base'`. If unavailable, find `read_plugin_resource` through `search_tools` first.
- Read the relevant [table, form, and ECharts patterns](references/ui-patterns.en-US.md) through `resourceId:'ui-patterns'`; adopt only the parts the app needs. Host-rendered `tree` pages already use system components and do not need copied CSS.
- For new React apps, read the [React project and component guide](references/react-app.en-US.md) through `resourceId:'react-app-guide'`. Reuse the host's public components through `@setsuna/app` and icons from `lucide-react`; base styles load automatically. Use SelectField with onValueChange, Checkbox and Markdown instead of native controls or copied implementations.
- For OpenUI charts, presentation cards, Chips, OptionCards or carousels, read the [OpenUI guide](references/openui.en-US.md) through `resourceId:'openui-guide'`. Declare its optional dependencies and use the shared theme from `@setsuna/app/openui`. Write React props and local state directly; chat `openui` fences and DSL signatures do not apply to app components.
- For buttons, fields, selects, tabs, dialogs or icons in existing HTML documents, read the [component guide](references/ui-components.en-US.md) through `resourceId:'ui-component-guide'` and reuse `ui-components` and `ui-icons`. The latter supplies 80 Lucide icons from the same source as the host; do not invent SVG paths. Include the scripts in the app's JS as documented, without React or new dependencies.
- For HTML documents, write base CSS into the app's `ui/app.css`, append app styles, and deliver local files through resource IDs. Browser pages may also load remote stylesheets, `@import`, and CDN resources.
- The guidelines govern color, typography, spacing, alignment, and interaction states without forcing one business layout. Do not put the guidelines, sample sections, unrelated fields, or decorative data into the user's UI.

## Bundle rules

Submit a complete snapshot to `configure_plugin`:

- `manifest` must include at least a stable lowercase `id` and user-facing `name`; use Bundle v2 fields.
- `files` includes every UTF-8 text file except `.setsuna-plugin/plugin.json`. Updating removes files omitted from the new snapshot.
- For apps, prefer writing and editing files in the current workspace (the current temporary workspace when no project is selected), then submit `{ "path": "ui/app.html", "sourcePath": "ui/app.html" }`. `path` is the bundle destination; `sourcePath` is workspace-relative or an absolute path within approved readable roots. The host reads the original file directly; do not read back and copy all source into the call.
- Each item must provide exactly one of `sourcePath` or `content`. Small snippets may use `content` as an ordinary JSON string. Do not add XML/HTML entity escaping or Base64 encoding; preserve source entities such as `&amp;`, tags, quotes, and newlines. For `$text`, non-string content, or malformed file arrays, retry with `sourcePath` instead of repeatedly generating JSON/XML payload files, guessing ports, or searching for tokens.
- The limit is 64 text files and 512 KiB in total. This tool cannot create binary assets such as images.
- The extension entry must be a bundled `.mjs`, using `apiVersion: 1`, `runtime: node-worker`, and only the capabilities actually used: `tools`, `events`, `state`, `ui`, `network`.
- `rendererUi` requires `ui`; state bindings also require `state`. Keep host DOM access isolated.
- Do not declare `image-generation` or `vision-recognition`; these private host bridges are reserved for the bundled marketplace and cannot be installed in local or chat-created plugins.
- `network` requires exact HTTP(S) origins without paths or credentials in `extension.network.allowedOrigins`. Call `context.network.request(...)` on the handler's second argument to use app proxying, cancellation, timeouts, and response-size limits. `response.body` is always a string: check `response.ok`/`response.status`, then use `await response.json()` or `JSON.parse(response.body)` before accessing fields. There is no `api.network`.
- React projects support their own package.json and registry packages. The host installs and builds during approved install/update, without running lifecycle scripts. Do not submit node_modules. HTML documents and backend workers remain self-contained.
- Before calling, verify `extension.entry`, all `resources[].path` values, every Skill's `SKILL.md`, and every `{{pluginRoot}}` reference exist in this same complete `files` snapshot. Do not probe validation one error at a time with incomplete snapshots.

## App handlers

`activate(api)` exposes only `registerTool`, `on`, and `onUiAction`. Page actions use `api.onUiAction(id, async (input, context) => ...)`; React/document data arrives in `input.payload`, and host form fields in `input.values`. Runtime capabilities are on `context`, never `api.network`, `api.state`, or `api.ui`.

State methods are `context.state.get(key, scope?)`, `set(key, value, scope?)`, and `delete(key, scope?)`. UI actions default to the contribution data scope; tool/event handlers default to `thread`. Use the declared `global`/`project`/`thread` scope consistently. API keys use `field.secret: true` in a Plugin details form, without `defaultValue`; read them through `context.secrets.get(name)`, never normal state or form values.

## Renderer UI

### Open an existing website

For a website sidebar entry, configure a schema v2 contribution with `webpage`. Do not generate an iframe, replica, or proxy. Submit this complete `configure_plugin` input directly, adapting IDs, labels and the URL to the request:

```json
{
  "manifest": {
    "id": "baidu",
    "name": "Baidu",
    "extension": {
      "apiVersion": 1,
      "runtime": "node-worker",
      "entry": "extension/entry.mjs",
      "capabilities": ["ui"],
      "rendererUi": {
        "schemaVersion": 2,
        "actions": [],
        "contributions": [{
          "id": "baidu.page",
          "slot": "renderer.plugin.page",
          "navigation": { "label": "Baidu" },
          "webpage": { "url": "https://www.baidu.com/" }
        }]
      }
    }
  },
  "files": [{ "path": "extension/entry.mjs", "content": "export default function activate() {}\n" }]
}
```

Choose exactly one of `tree`, `document`, `webpage`, or `reactApp`. Webpage mode requires `ui` and an HTTP(S) URL, with no document resources, state binding, or UI actions. Clicking the sidebar opens the native browser page with existing login, downloads, and browser settings. Remote websites receive no `setsunaUI` bridge. Default to `reactApp` for new local apps; both `reactApp` and `document` support Setsuna backend access.

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

- `renderer.capabilities.plugin.details`: configuration forms embedded in the owning Plugin details, including ordinary fields, selects and host-managed secrets. No sidebar entry is needed. A secrets-only form needs neither `data` nor the `state` capability.
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

### React standalone apps

React/document `invokeAction(id, data)` passes `data` unchanged to the worker's `input.payload`; `input.values` is only for host-rendered tree forms. Validate input before writes and throw on missing or invalid arguments instead of substituting an empty list and overwriting data. Use declared SDK props; TS/TSX is checked before building. Empty initial state does not mean the bridge is unready: do not keep inputs disabled because business fields are missing, and preserve drafts across snapshot refreshes.

Default to `reactApp` for new standalone apps. Read `react-app-guide`, prepare an independent project with default-exported page components and routes as needed, and reuse SDK components, theme styles and state/action/runtime hooks. Submit source and package.json in the complete snapshot; page files do not need individual resource declarations.

### Compatible HTML standalone pages

Keep `document` in the `renderer.plugin.page` contribution when maintaining an existing HTML/CSS/JS app. The entry appears below Plugins in the left sidebar. The app fills the main area without a host title, description, card border, or width limit. Submit HTML/CSS/JS as Bundle text files and declare them in `resources`:

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

Pages have a separate `setsuna-plugin-ui://` browser origin and support fetch, remote scripts/styles, localStorage/IndexedDB, workers, nested frames, media, downloads, external links, and HTTP(S) form submission. Browser CORS and website embedding policies still apply; use `webpage` for an existing website. Pages cannot read local files, access Node/Electron/preload or the host DOM. Use the document bridge or worker capabilities for project/runtime operations.

The host provides compatible `window.alert`, `window.confirm` and `window.prompt`, also callable without the `window.` prefix. They retain synchronous semantics: `confirm` returns true on confirmation and false on cancellation; `prompt` supports a default value and returns a string (including an empty string) on confirmation or null on cancellation; `alert` waits until dismissed. The current window's script waits for the user, so do not call them in render or refresh loops. Use the shared `SetsunaComponents.dialog` or a page-local `<dialog>` for complex forms; see `ui-component-guide`. Close after persistence succeeds, preserve input on failure, and do not mutate data on cancellation.

#### Create an app from one request

- For “make a customer table with an entry form and a sales chart”, generate one complete app with its page, interactions, and save action. Tables, forms, and charts can be combined freely; do not ask the user to choose a tech stack or write a manifest.
- Compose layout, columns, filtering, validation, and interaction for the request, reusing the design guidelines and base styles by default. Implement requested features only, without adding persistent explanations or summaries. Use `--setsuna-*` variables for the host theme. The page owns its full viewport; use `height:100%`, flex/grid, and internal scrolling as needed.
- Default to `data: { stateKey: "app.view", scope: "global" }` for business data shared with workers, using the same key/scope. Use project/conversation scopes when requested. Browser-only applications may use localStorage/IndexedDB; keep plugin and page IDs stable to preserve their storage origin.
- Use stable row IDs. Keep sorting, filtering, and edit drafts in the page and submit bounded payloads with `setsunaUI.invoke`. Ordinary saves, app data updates and refreshes declare only the action `id`, omitting optional `approval`, and execute directly. Batch or debounce autosaves. Validate fields, types, record counts and data size in the worker before writing `context.state`; no per-save approval or separate storage channel is needed.
- Use `approval: { title?, message }` only for interactions needing extra confirmation, such as deletion. If the page already confirms with `confirm` or `UI.dialog`, omit action `approval` to avoid duplicate dialogs. For an existing app, remove the save action's old `approval` to save directly. This does not change installation trust, tool approvals or the host's unsaved-edit checks when deleting conversations.
- Forms support submit events, native validation, and HTTP(S) submission. For bridge saves, preventDefault in the submit handler so button clicks and Enter share the same path. Preserve drafts on failure and update tables/charts after persistence succeeds.
- Both `ready` and `subscribe` can deliver snapshots, including theme notifications. Do not recreate forms, overwrite unsaved inputs, or register duplicate handlers on every notification. Update saved-data views only when their data changes.
- Keep plugin ID, state key, scope, and record IDs stable across app updates. New fields must tolerate old records. Never replace existing data with examples. Snapshots are limited to 64 KiB and 512 data entries; design for small local apps, without promising unlimited tables.
- After installation, use `verify_plugin` for actual save/read paths without damaging data. For new apps, use only user-requested initial records. For updates, use an explicitly implemented dry-run or save the unchanged current state; never insert test records or clear existing data.

#### ECharts

Declare `"libraries": ["echarts"]` in `document` for host-bundled offline `window.echarts`. Generate chart options and interaction code without copying ECharts or running a package manager. Other browser libraries can load as remote resources. Use the themed chart template with container resize, theme updates, unsubscribe/dispose on unload, and actual data fields and units.

## Workflow

1. Determine whether this is creation or update; infer the plugin ID, name, and capabilities from the request.
2. Ask only for core behavior, external service details, or platform requirements that cannot safely be inferred. Create directly when requirements are clear.
3. Generate the complete manifest and prepare all text files in the current workspace, preferring `sourcePath` for submission. Do not ask the user to prepare a local directory or call `install_plugin_bundle`.
4. Call `configure_plugin`. Before approval, briefly describe the app, resources, and backend handlers to install.
5. If preflight fails, fix every listed field and file and submit a new complete snapshot. Do not end the turn with promises to finish later.
6. `Installed and enabled: true` confirms only manifest, syntax, React type checking/building and worker activation. For extensions with tools or UI actions, immediately call `verify_plugin` using representative, read-only inputs covering every user-facing execution path. Tools declaring `uiCards` are required to return a valid `plugin.ui-card`.
7. For UI actions, provide `contributionId`. React/document checks must use the actual page's `payload` with empty `values`. Save checks must assert submitted values with `expectStateValues`; `expectStatePaths` proves only existence, and an empty array passing does not prove adding works. Never insert test records or clear user data. Use a user-requested real write, an implemented dry-run, or read existing data and save it unchanged. External writes must use dry-run; obtain explicit user authorization when no safe method exists.
8. `verify_plugin` returning `checksPassed:true` proves only the listed host-handler or API checks. A `ui-action` check calls the worker directly without executing page JavaScript, clicking buttons or testing dialogs; `pageInteractionsVerified:false` means page interactions remain unverified. Report the actual scope, without claiming that buttons, dialogs or the entire app were verified. On failure, repair the complete snapshot, call `configure_plugin` again and recheck. Claim page behavior was verified only with separate interaction evidence; do not use a browser or computer-use without the user's authorization just to obtain it.
9. Updates also require complete snapshots. If the same plugin ID belongs to the built-in marketplace or another directory, explicitly tell the user that installation failed because a same-name plugin already exists and to choose a different name before reinstalling. A new app must change both `pluginId` and `manifest.id`; changing only `manifest.name` will fail again. Do not alter the existing plugin's source or retry its ID unchanged.

## Safety boundaries

- Do not invent or embed credentials, or read runtime, model, or native bridge tokens through an extension.
- Executable extensions run in separate Node workers, not an OS sandbox, and retain the current user's filesystem and network permissions.
- Approval binds the current manifest, complete file contents, and hash. Approved Hooks and extensions are installed and enabled; later content changes require approval again.
- File tools may prepare source in the current workspace, but never write private runtime draft/install directories or bypass `configure_plugin` through sideloading. The tool reads `sourcePath`, validates snapshot JavaScript, and verifies staged worker activation after approval; no separate `node --check` is needed. Source changes after approval invalidate the preview and require resubmission.
