---
name: create-plugin-in-chat
description: "Create or update Setsuna plugins from chat, including Skills, MCP servers, Hooks, executable tools, conversation cards, and Plugin details forms. Generate a complete plugin bundle and call configure_plugin."
---

# Create plugins in chat

This Skill belongs to Plugin Builder. This builder is built in; the capability page's “Create plugin in chat” action selects it in chat. Generate and install a complete Plugin Bundle through `configure_plugin`; do not ask the user to prepare an unpacked directory or write private runtime directories. Wait for the user to send a prefilled draft before acting.

This builder creates agent capabilities and plugin configuration. Use App Builder for standalone sidebar apps, website entries, tables, forms, and dashboards; do not add a sidebar app merely to configure a plugin. Preserve existing IDs, stored state, and unrelated capabilities when updating.

## Choose the capability

- For model instructions or workflows, use `skills/<name>/SKILL.md` and declare the directory in manifest `skills`.
- For external services, use `mcpServers`; never embed API keys, fixed secrets, authentication headers, or credential-bearing URLs.
- For local commands around the Agent lifecycle, use `hooks` and reference bundled scripts through `{{pluginRoot}}`.
- For dynamic tools, lifecycle events, state, or structured user questions, use `extension`.
- For plugin settings, use a host `tree` in `extension.rendererUi` at `renderer.capabilities.plugin.details`. The form appears in the owning Plugin details; omit `navigation` and do not create a sidebar app for configuration fields. API keys use `field.secret: true`. Read the [complete form example](references/plugin-settings.en-US.md) through `read_plugin_resource({pluginId:'plugin-builder',resourceId:'plugin-settings-guide'})` first.
- For interactive cards after a tool runs, declare the card name, tool, and static sandbox preview in `extension.uiCards`, then return `plugin.ui-card@1` from the tool.
- `tools` is display metadata and does not register executable tools; use `api.registerTool` in the extension.
- `resources` declares Agent-readable resources and the HTML/CSS/JS files referenced by sandboxed pages.

Read the `conversation-cards-guide` resource before adding tool result cards.

## Bundle rules

Submit a complete snapshot to `configure_plugin`:

- `manifest` must include at least a stable lowercase `id` and user-facing `name`; use Bundle v2 fields.
- `files` includes every UTF-8 text file except `.setsuna-plugin/plugin.json`. Updating removes files omitted from the new snapshot.
- Prefer writing and editing files in the current workspace (the current temporary workspace when no project is selected), then submit `{ "path": "extension/entry.mjs", "sourcePath": "extension/entry.mjs" }`. `path` is the bundle destination; `sourcePath` is workspace-relative or an absolute path within approved readable roots. The host reads the original file directly; do not read back and copy all source into the call.
- Each item must provide exactly one of `sourcePath` or `content`. Small snippets may use `content` as an ordinary JSON string. Do not add XML/HTML entity escaping or Base64 encoding; preserve source entities such as `&amp;`, tags, quotes, and newlines. For `$text`, non-string content, or malformed file arrays, retry with `sourcePath` instead of repeatedly generating JSON/XML payload files, guessing ports, or searching for tokens.
- The limit is 64 text files and 512 KiB in total. This tool cannot create binary assets such as images.
- Every Skill directory must contain a complete `SKILL.md`, without TODOs, placeholders, or omitted content.
- Hook commands should reference bundled scripts; provide `commandWindows` when needed.
- The extension entry must be a bundled `.mjs`, using `apiVersion: 1`, `runtime: node-worker`, and only the capabilities actually used: `tools`, `events`, `state`, `ui`, `network`.
- `rendererUi`, `uiCards`, and `plugin.ui-card` require `ui`. Put cards at `manifest.extension.uiCards` with each toolName matching a top-level tool. Previews use static, side-effect-free example source and bounded data; they do not execute tools or replace real tool results. Runtime state bindings also require `state`. Keep host DOM access isolated.
- Do not declare `image-generation` or `vision-recognition`; these private host bridges are reserved for the bundled marketplace and cannot be installed in local or chat-created plugins.
- `network` requires exact HTTP(S) origins without paths or credentials in `extension.network.allowedOrigins`. Call `context.network.request(...)` on the handler's second argument to use app proxying, cancellation, timeouts, and response-size limits. `response.body` is always a string: check `response.ok`/`response.status`, then use `await response.json()` or `JSON.parse(response.body)` before accessing fields. There is no `api.network`.
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
- Secrets: handlers use `await context.secrets.get(name)` to read their plugin's declared details credential as a string or `null`. The host encrypts form edits; `input.values` excludes secrets. Never put keys in state, source files, tool arguments or outputs, or ask users to provide real keys in chat.
- State: `context.state.get(key, scope?)`, `set(key, value, scope?)`, `delete(key, scope?)`. Tool/Event default to `thread`; UI Action uses the contribution's `data.scope`. Explicitly use the matching `global`/`project`/`thread` scope when sharing sidebar state across entry points.
- Network response: `{ ok, status, statusText, headers, body, text(), json() }`. `body` is UTF-8 text, not an object; do not use `response.body.current`.

Declare only supported events with verified behavior. Do not add nonessential automatic synchronization just for completeness; incorrect events and unverified payload assumptions reduce reliability.

## Workflow

1. Determine whether this is creation or update; infer the plugin ID, name, and capabilities from the request.
2. Ask only for core behavior, external service details, or platform requirements that cannot safely be inferred. Create directly when requirements are clear.
3. Generate the complete manifest and prepare all text files in the current workspace, preferring `sourcePath` for submission. Do not ask the user to prepare a local directory or call `install_plugin_bundle`.
4. Call `configure_plugin`. Before approval, briefly describe the Skills, MCP servers, Hooks, resources, and extension to install, including whether it contains executable code.
5. If preflight fails, fix every listed field and file and submit a new complete snapshot. Do not end the turn with promises to finish later.
6. `Installed and enabled: true` confirms only manifest, syntax and worker activation. For extensions with tools or UI actions, immediately call `verify_plugin` using representative, read-only inputs covering every user-facing execution path. Tools declaring `uiCards` are required to return a valid `plugin.ui-card`.
7. For UI actions, provide `contributionId`. Host configuration forms use `values`; only sandboxed documents use `payload`. Save checks must assert submitted values with `expectStateValues`; `expectStatePaths` proves only existence, and an empty array passing does not prove adding works. Never insert test records or clear user data. Use a user-requested real write, an implemented dry-run, or read existing data and save it unchanged. External writes must use dry-run; obtain explicit user authorization when no safe method exists.
8. `verify_plugin` returning `checksPassed:true` proves only the listed host-handler or API checks. A `ui-action` check calls the worker directly without executing page JavaScript, clicking buttons or testing dialogs; `pageInteractionsVerified:false` means page interactions remain unverified. Report the actual scope, without claiming that buttons, dialogs or the entire app were verified. On failure, repair the complete snapshot, call `configure_plugin` again and recheck. Claim page behavior was verified only with separate interaction evidence; do not use a browser or computer-use without the user's authorization just to obtain it.
9. Updates also require complete snapshots. If the same plugin ID belongs to the built-in marketplace or another directory, explicitly tell the user that installation failed because a same-name plugin already exists and to choose a different name before reinstalling. A new plugin must change both `pluginId` and `manifest.id`; changing only `manifest.name` will fail again. Do not alter the existing plugin's source or retry its ID unchanged.

## Safety boundaries

- Do not invent or embed credentials, or read runtime, model, or native bridge tokens through an extension.
- Executable extensions run in separate Node workers, not an OS sandbox, and retain the current user's filesystem and network permissions.
- Approval binds the current manifest, complete file contents, and hash. Approved Hooks and extensions are installed and enabled; later content changes require approval again.
- File tools may prepare source in the current workspace, but never write private runtime draft/install directories or bypass `configure_plugin` through sideloading. The tool reads `sourcePath`, validates snapshot JavaScript, and verifies staged worker activation after approval; no separate `node --check` is needed. Source changes after approval invalidate the preview and require resubmission.
