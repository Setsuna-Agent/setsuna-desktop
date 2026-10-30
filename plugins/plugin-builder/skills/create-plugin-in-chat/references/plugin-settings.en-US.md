# Plugin details configuration forms

For plugin configuration, put a host `tree` in `renderer.capabilities.plugin.details`. Each plugin supports one details form. No sidebar entry, React project, page resources, CSS or `navigation` is needed.

## One API key field

This complete example can be submitted to `configure_plugin`. Adapt its ID/name to the actual plugin; preserve other files, tools and capabilities when updating an existing plugin.

```json
{
  "manifest": {
    "id": "service-search",
    "name": "Service Search",
    "extension": {
      "apiVersion": 1,
      "runtime": "node-worker",
      "entry": "extension/entry.mjs",
      "capabilities": ["ui"],
      "rendererUi": {
        "schemaVersion": 2,
        "actions": [{ "id": "settings.save" }],
        "contributions": [{
          "id": "settings",
          "slot": "renderer.capabilities.plugin.details",
          "tree": {
            "type": "stack",
            "children": [
              { "type": "field", "name": "apiKey", "label": "API Key", "secret": true },
              { "type": "button", "actionId": "settings.save", "label": "Save", "variant": "primary" }
            ]
          }
        }]
      }
    }
  },
  "files": [{
    "path": "extension/entry.mjs",
    "content": "export default function activate(api) { api.onUiAction('settings.save', async () => {}); }\n"
  }]
}
```

The empty save handler is intentional: the host saves credential edits before calling it. A secrets-only form needs neither the `state` capability nor `data`. Omit `approval` for ordinary saves.

- `secret: true` is limited to schema v2 Plugin details fields. It forbids `defaultValue`. Never include actual keys in manifests, files or tool arguments.
- The user enters keys in the details form. Empty input retains the old key; the clear icon stages deletion, applied on save. `required: true` prevents saving a missing credential; omit it when users should be able to clear configuration, and check for a key when running the tool.
- The host uses OS-encrypted credential storage. Reads expose presence only, never plaintext through `input.values`, ordinary state or form hydration.
- Handler failure does not roll back saved credentials. Test buttons also apply current edits before executing the test; register a real handler for any declared test action.
- Uninstall deletes credentials. Stable plugin IDs and field names preserve settings across updates.

## Use credentials in a tool

Read a key in an existing `execute(input, context)` or UI action handler. `activate(api)` has no `secrets` API. No additional capability is needed; the host permits only names declared in that plugin's details form.

```js
const apiKey = await context.secrets.get('apiKey');
if (!apiKey) throw new Error('Configure the API key in Plugin details first.');
```

Use it in the actual service request's authentication header. Requests still need `network` and the service's exact `allowedOrigins`. Never return keys in results, errors, logs or page state.

## Ordinary fields

Ordinary `field` / `select` nodes may share the same tree with secret fields. Read ordinary values from `input.values` and persist them through `context.state.set`. Declare `state` and `data: { "stateKey": "settings", "scope": "global" }`. Bind a city field with `defaultValue: { "path": "city" }` and write `{ city: input.values.city }` in the save handler. Never bind credentials to state.

## Verification

After installation, run a `verify_plugin` `ui-action` check for `settings.save`, with `contributionId: "settings"` and ordinary field `values`. Users enter secrets through Plugin details, never through the verification tool. Run external-service checks once configured; if a key is missing, report that service calls remain unverified.
