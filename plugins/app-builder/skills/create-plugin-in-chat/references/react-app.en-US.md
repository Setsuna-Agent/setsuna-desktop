# React app projects

Default to `reactApp` for new local sidebar apps. Each contribution points to its own project; the host supplies a shared React/Vite base, routing, default dependencies and `@setsuna/app`. The page runs in its own origin.

## Files and routes

Prepare source in the current workspace and submit a complete snapshot through `configure_plugin`. Organize components, hooks and pages freely within the project. Do not submit `node_modules`, `.setsuna`, `.npmrc`, pnpm hooks or workspace configuration.

```text
extension/entry.mjs
app/package.json
app/pages/Home.tsx
app/pages/Detail.tsx
app/components/Item.tsx
app/hooks/useItems.ts
app/styles.css
```

```json
{
  "extension": {
    "apiVersion": 1,
    "runtime": "node-worker",
    "entry": "extension/entry.mjs",
    "capabilities": ["ui", "state"],
    "rendererUi": {
      "schemaVersion": 2,
      "actions": [{ "id": "items.save" }],
      "contributions": [{
        "id": "items.page",
        "slot": "renderer.plugin.page",
        "navigation": { "label": "Items" },
        "data": { "stateKey": "items.view", "scope": "global" },
        "reactApp": {
          "root": "app",
          "entry": "pages/Home.tsx",
          "routes": [{ "path": "/items/:id", "entry": "pages/Detail.tsx" }],
          "actionIds": ["items.save"]
        }
      }]
    }
  }
}
```

`root` is relative to the Bundle; entry modules are relative to the project. Default-export a React component from every page. The default entry handles unmatched paths; routes declare other paths and parameters. The host supplies `HashRouter`: navigate with `Link` or `useNavigate` without nesting another Router. TS/TSX, JS/JSX, relative and dynamic imports, CSS and inline images/fonts are supported. There is no separate static file server, so `public/` URLs are not automatically published. Rendering waits for bridge readiness. The host automatically imports root styles.css for every route. Import other CSS explicitly from pages or components; including a CSS file in the snapshot alone does not load it.

## Defaults, components and styles

- OpenUI is available for charts, presentation cards, Chips, OptionCards and carousels. Read the [component guide](openui.en-US.md) through `read_plugin_resource({pluginId:'app-builder',resourceId:'openui-guide'})`, declare its optional dependencies and wrap the app in `OpenUiProvider`. Apps that do not use OpenUI need no additional packages.
- Defaults include React 18, React DOM, React Router 7, Lucide React, TypeScript and React types.
- `@setsuna/app` reuses the host's public renderer-ui components: buttons/icon buttons, fields, select, checkbox, switch, slider, menus, Popover, Tooltip, Dialog/ConfirmDialog, Tabs, tables, image preview, ToastStack, Skeleton, ProgressRing and file trees. AppLayout, Panel and data hooks remain SDK helpers. Apps supply text, labels, columns and content.
- `Button.variant` supports only primary, secondary, ghost and danger, plus size, icon and loading props. Use `IconButton label="…"` for icon buttons. TextField accepts native props plus optional label and leadingIcon; TextArea supports autoSize. Fields have no hideLabel prop: omit label and provide aria-label when appropriate. TS/TSX is checked before installation; do not rely on Vite ignoring invalid props.
- SelectField uses the host's floating listbox with value, onValueChange(value) and option children. It supports empty-string values, disabled options, name and required; do not pass native onChange events or use a native select. Checkbox uses checked, onChange(event) and label (or children), with native form props/refs. Switch uses checked, onCheckedChange(boolean) and label.
- Import icons from `lucide-react`; icon buttons need an aria-label and tooltip.
- Base CSS loads automatically from the host's tokens and control styles, retaining setsuna variables and sa layout classes. Import only app-specific CSS and customize through the component's declared className/style props. Do not copy host control CSS or concatenate legacy ui-components.js into React pages.
- Fields fill their form container by default. In a filter toolbar, give selects an explicit width or flex/grid track, let search grow, and retain wrapping in narrow windows; putting full-width fields in flex-wrap does not keep them on one row.
- Table takes rows, columns (`{key, header, render(row), align?, width?}`) and getRowKey, with optional caption, loading and emptyState. Dialog takes open, onClose, children and optional title/footer, sharing the host's focus trap, Escape behavior and positioning. Apps own its state. Mount ConfirmationProvider around the app before calling useConfirm.
- Markdown (also exported as DocumentMarkdown) accepts content, optional baseUrl, className and onOpenLink(url). It supports GFM tables, task lists, code blocks, emoji, heading anchors and sanitized HTML. External links use the existing browser flow by default; callbacks can handle navigation. It accesses no filesystem, preload or runtime. Use it for basic reading instead of injecting HTML or adding a duplicate parser.

```tsx
import { useState } from 'react';
import { SelectField, Checkbox, Markdown } from '@setsuna/app';

export function Filters({ projects, description }: {
  projects: { id: string; name: string }[]; description: string;
}) {
  const [projectId, setProjectId] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  return <>
    <SelectField aria-label="Project" value={projectId} onValueChange={setProjectId}>
      <option value="">All projects</option>
      {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </SelectField>
    <Checkbox label="Include archived" checked={includeArchived} onChange={event => setIncludeArchived(event.currentTarget.checked)} />
    <Markdown content={description} />
  </>;
}
```

```tsx
import { useState } from 'react';
import { AppLayout, Button, TextField, Link, useAppData, invokeAction } from '@setsuna/app';
import '../styles.css';

export default function Home() {
  const saved = useAppData<{title?:string}>();
  const [draft, setDraft] = useState(saved.title ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return <AppLayout><form onSubmit={async event => {
    event.preventDefault(); setSaving(true); setError('');
    try { await invokeAction('items.save', {title:draft}); }
    catch (error) { setError(String(error)); }
    finally { setSaving(false); }
  }}>
    <TextField label="Title" value={draft} onChange={event => setDraft(event.target.value)} required />
    <Button type="submit" disabled={saving}>Save</Button>
    {error && <div role="alert">{error}</div>}
  </form><Link to="/items/1">Detail</Link></AppLayout>;
}
```

Preserve an existing app's design. Do not add unrequested persistent explanations, summaries, example records or guidance.

The page's `invokeAction('items.save', {title:draft})` pairs with this worker. The second argument arrives as `input.payload`; `input.values` is only for string fields in host-rendered `tree` forms.

```js
export default function activate(api) {
  api.onUiAction('items.save', async (input, context) => {
    const title = input?.payload?.title;
    if (typeof title !== 'string' || !title.trim() || title.length > 200) {
      throw new Error('Invalid title');
    }
    const current = await context.state.get('items.view', 'global') ?? {};
    await context.state.set('items.view', { ...current, title: title.trim() }, 'global');
  });
}
```

Validate payloads before writes. Throw on missing or invalid input instead of substituting an empty array/object and saving it. Preserve existing records and other fields.

## Dependencies

Every project has its own package.json and dependency directory. Add browser-compatible registry packages to dependencies:

```json
{ "dependencies": { "zod": "4.4.3", "echarts": "6.1.0" } }
```

The host adds defaults and local `@setsuna/app`, installs packages with pnpm, checks TypeScript and then builds with Vite during an approved install/update. Ordinary opens read cached output; a failed type check or build retains the existing version and business data. Do not access runtime cache directories or start a Vite server manually.

You may submit pnpm-lock.yaml to pin versions. Registry versions, ranges and tags are supported; file/git/workspace dependencies, custom Vite/PostCSS configuration, Node-based CSS preprocessors, lifecycle scripts and native Node modules are unsupported. Package scripts do not run. Worker extensions remain self-contained .mjs modules; frontend packages do not become worker dependencies.

## Data and permissions

- `useAppData<T>()`, `useAppContext()` and `useAppSnapshot<T>()` subscribe to the existing setsunaUI snapshot. The bridge is ready before mounting. Initial `{}` state or a missing business field such as `todos` means no records yet; do not use it to disable input indefinitely. Keep drafts in local state and clear them only after successful saving or cancellation, rather than on every snapshot update.
- `invokeAction(id,payload)` calls an action in the contribution's allowlist and its existing api.onUiAction handler. Preserve plugin IDs, state keys, scopes and record IDs. Ordinary saves omit action approval; use existing confirmation rules where required.
- `requestRuntime({path,method?,body?})` returns `{ok,status,data}` through the existing backend bridge; check ok. Pages hold no local runtime port, token, preload or filesystem access.
- Camera, microphone, geolocation and clipboard use the existing main-process page permissions; route changes grant no new capability.
- React `verify_plugin` checks must use the page's exact submitted object as `payload`, with empty `values`. Assert submitted values with `expectStateValues` (such as `title` or `todos.0.title`). `expectStatePaths` proves only existence; passing an empty list does not prove adding works. Use an actual write requested by the user, an implemented dry-run, or read existing data and save it unchanged. Never insert test records and then clear user state.
- `verify_plugin` checks actual worker actions, state and runtime APIs without executing page JavaScript. Report its actual scope without claiming clicks, dialogs or styles were verified.
