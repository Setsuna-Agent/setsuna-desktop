# Shared components and icons

These resources work directly in HTML/JS sandbox apps, using host theme variables and `sa-*` styles. Do not import the host's internal React components.

## Setup

Read resources with `read_plugin_resource({pluginId:'app-builder',resourceId:...})`:

| Resource ID | Contents |
| --- | --- |
| `ui-base` | Shared CSS for buttons, fields, tables, panels, badges, tabs, and dialogs |
| `ui-components` | `window.SetsunaComponents`: native DOM components and interaction |
| `ui-icons` | `window.SetsunaIcons`: 80 offline Lucide SVG icons |

Copy the CSS into the app's stylesheet. Concatenate the required scripts in **ui-icons → ui-components → app logic** order into the app's own `ui/app.js`, loaded through `document.jsResourceId`. Omit the component script when only icons are needed. Preserve the icon file's license header. Do not add external script/link tags or declare `lucide`/`setsuna-ui` in `document.libraries`; these are not host-injected libraries.

The globals exist after these scripts execute. DOM components do not depend on `setsunaUI.ready`; backend/state access still uses the existing `setsunaUI` bridge. Returned native DOM nodes accept native attributes and events. No additional framework, renderer, or keyboard-state implementation is needed.

## Components

| Call | Parameters / return value |
| --- | --- |
| `button(options)` | `label, icon?, iconOnly?, variant?, disabled?, onClick?`; returns `HTMLButtonElement`, type=button; variant is default/primary/ghost/danger |
| `field(options)` | `label, name, type?, value?, required?, onInput?`; returns `{element,input}`; native input types or textarea; onInput receives a string |
| `select(options)` | `label, name, options:[{label,value,disabled?}], value?, required?, onChange?`; returns `{element,input}`; onChange receives a string |
| `tabs(options)` | `items:[{id,label,content,disabled?}], value?, label?, onChange?`; content is a DOM node; returns `{element,value,setValue(id)}` |
| `dialog(options)` | `title, content, closeLabel, onClose?`; content is a DOM node; returns `{element,open(initialFocus?),close(value?),destroy()}` |

Tabs support arrow keys, Home/End, disabled-item skipping, and associated panels while preserving input drafts. `onChange` fires only when the selection changes. Dialogs attach to the current document at creation and appear on `open()`. They use native modal focus containment and Escape dismissal, restore the opener's focus after closing, and pass returnValue to `onClose`. Call `destroy()` when no longer needed; do not recreate them on each snapshot without cleanup.

Use host-compatible synchronous `window.alert/confirm/prompt` for simple messages, confirmations and input. Cancelling confirm returns false; cancelling prompt returns null, while an empty string is a valid confirmed value. For complex editors, combine the page-local `dialog` (native `<dialog>`) with fields, validation and asynchronous persistence. Close only after confirmation and successful persistence; preserve input on failure. The close button and Escape only cancel, without saving or deleting.

Use native HTML with `ui-base` for tables, checkboxes, panels, and badges; see `ui-patterns` for table/form markup. Validation, persistence, sorting, and business rules belong to the app; components do not request or mutate data.

```js
const UI = window.SetsunaComponents;
const name = UI.field({ label: 'Name', name: 'name', required: true });
name.input.maxLength = 120;
const form = document.createElement('form');
form.className = 'sa-stack';
form.addEventListener('submit', (event) => event.preventDefault());
form.append(name.element);
const editor = UI.dialog({ title: 'Edit record', content: form, closeLabel: 'Close' });
const edit = UI.button({ label: 'Edit', icon: 'pencil', onClick: () => editor.open(name.input) });
document.querySelector('#actions').append(edit);
// Add a real save action; call editor.close('saved') only after validation and persistence succeed.
window.addEventListener('pagehide', () => editor.destroy(), { once: true });
```

Use these examples only when requested features need the controls, and supply localized labels. During asynchronous saves, manage native `disabled`/`aria-busy` and preserve drafts on failure. Component helpers do not replace missing business logic.

## Icons

```js
const icon = window.SetsunaIcons.create('search');
document.querySelector('#search-label').prepend(icon);
// Meaningful standalone icons need a label; icons alongside button text default to aria-hidden.
const status = window.SetsunaIcons.create('circle-check', { size: 20, label: 'Completed' });
// Fill HTML placeholders such as <span data-sa-icon="search"></span>.
window.SetsunaIcons.mount(document.querySelector('#app'));
```

`create` returns an SVG, defaults to 16px, and inherits currentColor. `mount` fills descendant `[data-sa-icon]` placeholders; call it after adding new content. `SetsunaIcons.names` contains the complete catalog. Unknown names throw a clear error. Icon buttons require a readable `label`, used for their tooltip and aria-label.

| Purpose | Common names |
| --- | --- |
| Editing | plus, minus, x, check, pencil, trash-2, copy, clipboard, save |
| Search/sort | search, filter, arrow-up-down, refresh-cw, rotate-ccw, sliders-horizontal |
| Navigation/actions | chevron-down, chevron-up, chevron-left, chevron-right, arrow-left, arrow-right, arrow-up-right, more-horizontal, more-vertical, external-link, link, download, upload |
| Apps/data | home, layout-dashboard, panels-top-left, table-2, columns-3, rows-3, list, list-checks, chart-column, chart-line, chart-pie, database |
| Files/collaboration | file, file-text, file-spreadsheet, folder, folder-open, calendar, clock, user, users, mail, phone, message-square, messages-square, send |
| Status/other | info, circle-help, circle-check, triangle-alert, loader-circle, eye, eye-off, lock, unlock, settings, tag, bookmark, star, heart, bell, sun, moon |

Choose icons by established meaning; do not replace functional icons with emoji or random colored artwork. App avatar presets serve a separate purpose. This catalog is generated from the repository's installed `lucide-react`, without network or a React runtime. Maintainers run `pnpm generate:app-icons` after changing the catalog or dependency version instead of editing generated SVG paths.
