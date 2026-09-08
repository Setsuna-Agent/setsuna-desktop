import {
  PLUGIN_UI_CARD_DECLARATION_LIMITS,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import type { PluginDraftInput } from '../../ports/plugin-draft-store.js';
import {
  PLUGIN_MANIFEST_RELATIVE_PATH,
  normalizePluginId,
  safeRelativePath,
} from '../plugin/file-plugin-bundle-model.js';
import { assertCompleteConfigurePluginSnapshot } from './configure-plugin-preflight.js';
import { objectInput, requiredStringArg } from './tool-input.js';

export const CONFIGURE_PLUGIN_TOOL = 'configure_plugin';
export const MAX_CONFIGURE_PLUGIN_FILES = 64;
export const MAX_CONFIGURE_PLUGIN_TEXT_BYTES = 512 * 1024;

export type ConfigurePluginAction = 'create' | 'update';

const rendererUiTextSourceSchema = {
  anyOf: [
    { type: 'string' },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Dot-separated path inside the declared contribution data.' },
        fallback: { type: 'string' },
      },
      required: ['path'],
    },
  ],
};

const rendererUiTreeSchema = {
  type: 'object',
  description: [
    'Recursive host-rendered node. Allowed exact shapes are:',
    'stack {type,direction?,gap?,children}; text/badge {type,text,tone?};',
    'notice {type,title?,text,tone?}; field {type,name,label,defaultValue?,placeholder?,required?,maxLength?};',
    'select {type,name,label,defaultValue?,options}; button {type,actionId,label,variant?}.',
    'Text, badge, notice text/title, and field/select defaults may use a {path,fallback?} binding.',
  ].join(' '),
};

/** Kept explicit because this schema is the model's primary source of truth. */
export const configurePluginRendererUiSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  description: [
    'Renderer UI v2 supports two modes.',
    'tree is a bounded host-rendered UI.',
    'document is a standalone sandboxed Plugin page backed by declared HTML/CSS/JS resources.',
    'A contribution must declare exactly one mode.',
  ].join(' '),
  properties: {
    schemaVersion: { type: 'integer', enum: [2] },
    actions: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          approval: {
            type: 'object',
            additionalProperties: false,
            properties: { title: { type: 'string' }, message: { type: 'string' } },
            required: ['message'],
          },
        },
        required: ['id', 'approval'],
      },
    },
    contributions: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        description: [
          'renderer.plugin.page requires navigation.',
          'renderer.settings.page.extensions requires target general or about.',
          'renderer.capabilities.plugin.details adds one contribution to the Plugin details page.',
          'Settings and Plugin details data must use global scope.',
          'Put stateKey and scope inside data, never at this contribution root.',
        ].join(' '),
        properties: {
          id: { type: 'string' },
          slot: {
            type: 'string',
            enum: [
              'renderer.plugin.page',
              'renderer.settings.page.extensions',
              'renderer.chat.composer.status',
              'renderer.capabilities.plugin.details',
            ],
          },
          target: { type: 'string', enum: ['general', 'about'] },
          order: { type: 'number' },
          navigation: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string' },
              badge: rendererUiTextSourceSchema,
            },
            required: ['label'],
          },
          data: {
            type: 'object',
            additionalProperties: false,
            description: 'Required for state bindings. Project scope requires an active project; thread scope requires a conversation.',
            properties: {
              stateKey: { type: 'string' },
              scope: { type: 'string', enum: ['global', 'project', 'thread'] },
            },
            required: ['stateKey', 'scope'],
          },
          tree: rendererUiTreeSchema,
          document: {
            type: 'object',
            additionalProperties: false,
            description: [
              'Free-form standalone UI loaded in an opaque-origin iframe.',
              'Network, Node, Electron, host DOM, forms, popups, downloads, and top navigation remain unavailable.',
              'JavaScript uses window.setsunaUI for state snapshots and declared host actions.',
            ].join(' '),
            properties: {
              htmlResourceId: { type: 'string' },
              cssResourceId: { type: 'string' },
              jsResourceId: { type: 'string' },
              actionIds: { type: 'array', maxItems: 32, items: { type: 'string' } },
            },
            required: ['htmlResourceId', 'actionIds'],
          },
        },
        required: ['id', 'slot'],
        anyOf: [
          { required: ['tree'] },
          { required: ['document'] },
        ],
      },
    },
  },
  required: ['schemaVersion', 'actions', 'contributions'],
};

export const configurePluginTool: RuntimeToolDefinition = {
  name: CONFIGURE_PLUGIN_TOOL,
  description: 'Create or update a managed local Setsuna Plugin Bundle from a complete manifest and UTF-8 text files. Requires user approval.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      manifest: {
        type: 'object',
        additionalProperties: false,
        description: 'Complete Plugin Bundle v2 manifest. schemaVersion is normalized to 2; featured marketplace fields are ignored.',
        properties: {
          schemaVersion: { type: 'integer', enum: [2] },
          id: { type: 'string', description: 'Stable lowercase plugin id.' },
          name: { type: 'string', description: 'User-facing plugin name.' },
          icon: { type: 'string', description: 'Optional built-in renderer icon token.' },
          version: { type: 'string', description: 'Plugin version. Defaults to 1.0.0.' },
          description: { type: 'string' },
          publisher: { type: 'string', description: 'Publisher label. Defaults to Local.' },
          tags: { type: 'array', items: { type: 'string' } },
          tools: {
            type: 'array',
            description: 'Optional display metadata for tools supplied by the plugin.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { name: { type: 'string' }, description: { type: 'string' } },
              required: ['name'],
            },
          },
          skills: {
            type: 'array',
            description: 'Relative Skill directories. Each directory must have a SKILL.md in files.',
            items: { type: 'string' },
          },
          mcpServers: {
            type: 'array',
            description: 'MCP servers without embedded credentials or environment values.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                key: { type: 'string' },
                label: { type: 'string' },
                description: { type: 'string' },
                transport: { type: 'string', enum: ['stdio', 'streamableHttp', 'streamable_http'] },
                command: { type: 'string' },
                args: { type: 'array', items: { type: 'string' } },
                cwd: { type: 'string' },
                url: { type: 'string' },
                timeoutMs: { type: 'integer' },
                startupTimeoutMs: { type: 'integer' },
                toolTimeoutMs: { type: 'integer' },
                allowedTools: { type: 'array', items: { type: 'string' } },
                disabledTools: { type: 'array', items: { type: 'string' } },
                oauthClientId: { type: 'string' },
                oauthResource: { type: 'string' },
              },
              required: ['key'],
            },
          },
          hooks: {
            type: 'array',
            description: 'Command Hooks. Bundle files should be referenced with {{pluginRoot}}.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                eventName: { type: 'string' },
                matcher: { type: 'string' },
                command: { type: 'string' },
                commandWindows: { type: 'string' },
                timeoutSec: { type: 'integer' },
                statusMessage: { type: 'string' },
              },
              required: ['eventName', 'command'],
            },
          },
          resources: {
            type: 'array',
            description: 'Declared text resources present in files, including sandboxed Plugin page HTML/CSS/JS.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { id: { type: 'string' }, label: { type: 'string' }, path: { type: 'string' } },
              required: ['id', 'path'],
            },
          },
          extension: {
            type: 'object',
            additionalProperties: false,
            description: [
              'Optional executable Node worker extension.',
              'A Plugin tool may return a sandboxed chat card in data using resultKind plugin.ui-card,',
              'resultMajor 1, and payload {id,title?,html,css?,js?,data?,permissions:{network:false,hostActions:[]}}.',
              'Declare each card in uiCards with a static sandbox preview so Plugin details can show it before execution.',
              'This requires the ui capability. The host injects pluginId and validates source limits before persistence.',
            ].join(' '),
            properties: {
              apiVersion: { type: 'integer', enum: [1] },
              runtime: { type: 'string', enum: ['node-worker'] },
              entry: { type: 'string', description: 'Relative JavaScript entry file present in files.' },
              capabilities: {
                type: 'array',
                items: { type: 'string', enum: ['tools', 'events', 'ui', 'state', 'network'] },
              },
              network: {
                type: 'object',
                additionalProperties: false,
                description: 'Required when network is declared. Requests use the runtime proxy and exact origin allowlist.',
                properties: {
                  allowedOrigins: {
                    type: 'array',
                    items: { type: 'string', description: 'Exact HTTP(S) origin, without a path.' },
                  },
                },
                required: ['allowedOrigins'],
              },
              uiCards: {
                type: 'array',
                maxItems: PLUGIN_UI_CARD_DECLARATION_LIMITS.entries,
                description: 'Install-time catalog metadata and a static sandbox preview for cards returned dynamically by declared tools.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', description: 'Stable card template id.' },
                    label: { type: 'string', description: 'User-facing card name.' },
                    description: { type: 'string' },
                    toolName: { type: 'string', description: 'Name of the declared tool that returns this card.' },
                    preview: {
                      type: 'object',
                      additionalProperties: false,
                      description: 'Static sample rendered without executing the tool, making network requests, or exposing host actions.',
                      properties: {
                        html: { type: 'string' },
                        css: { type: 'string' },
                        js: { type: 'string' },
                        data: { type: 'object', description: 'Bounded JSON sample data for window.setsunaUI.ready.' },
                      },
                      anyOf: [{ required: ['html'] }, { required: ['js'] }],
                    },
                  },
                  required: ['id', 'label', 'toolName', 'preview'],
                },
              },
              rendererUi: configurePluginRendererUiSchema,
            },
            required: ['apiVersion', 'runtime', 'entry', 'capabilities'],
          },
        },
        required: ['id', 'name'],
      },
      files: {
        type: 'array',
        description: `Complete UTF-8 text-file snapshot. Omitted files are removed on update; maximum ${MAX_CONFIGURE_PLUGIN_FILES} files and ${MAX_CONFIGURE_PLUGIN_TEXT_BYTES} bytes.`,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', description: 'Bundle-relative file path. The manifest file is generated automatically.' },
            content: { type: 'string', description: 'Complete UTF-8 text content.' },
          },
          required: ['path', 'content'],
        },
      },
    },
    required: ['manifest', 'files'],
  },
};

export function normalizeConfigurePluginInput(input: unknown): PluginDraftInput {
  const args = objectInput(input);
  const manifest = normalizeConfigurePluginManifestShorthand(jsonObject(args.manifest, 'manifest'));
  assertNoUnknownSchemaProperties(
    { ...args, manifest },
    configurePluginTool.inputSchema,
    'configure_plugin',
  );
  const pluginId = normalizePluginId(requiredStringArg(manifest.id, 'manifest.id'));
  const name = requiredStringArg(manifest.name, 'manifest.name');
  const normalizedManifest: Record<string, unknown> = {
    ...manifest,
    schemaVersion: 2,
    id: pluginId,
    name,
    version: optionalText(manifest.version) ?? '1.0.0',
    publisher: optionalText(manifest.publisher) ?? 'Local',
    tags: manifest.tags ?? [],
    featured: false,
  };
  delete normalizedManifest.schema_version;
  delete normalizedManifest.featuredOrder;
  delete normalizedManifest.featured_order;
  if (!Array.isArray(args.files)) throw new Error('files must be an array.');
  if (args.files.length > MAX_CONFIGURE_PLUGIN_FILES) {
    throw new Error(`configure_plugin supports at most ${MAX_CONFIGURE_PLUGIN_FILES} text files.`);
  }
  const seen = new Set<string>();
  const files = args.files.map((value, index) => {
    const file = objectInput(value);
    const relativePath = safeRelativePath(requiredStringArg(file.path, `files[${index}].path`), `files[${index}].path`)
      .replaceAll('\\', '/');
    const comparisonPath = relativePath.toLowerCase();
    if (comparisonPath === PLUGIN_MANIFEST_RELATIVE_PATH.replaceAll('\\', '/').toLowerCase()) {
      throw new Error('files cannot include .setsuna-plugin/plugin.json; it is generated from manifest.');
    }
    if (seen.has(comparisonPath)) throw new Error(`Duplicate configure_plugin file path: ${relativePath}`);
    seen.add(comparisonPath);
    if (typeof file.content !== 'string') throw new Error(`files[${index}].content must be text.`);
    return { path: relativePath, content: file.content };
  }).sort((left, right) => left.path.localeCompare(right.path));

  const bytes = Buffer.byteLength(JSON.stringify(normalizedManifest))
    + files.reduce((total, file) => total + Buffer.byteLength(file.content), 0);
  if (bytes > MAX_CONFIGURE_PLUGIN_TEXT_BYTES) {
    throw new Error(`configure_plugin text input exceeds ${MAX_CONFIGURE_PLUGIN_TEXT_BYTES} bytes.`);
  }
  const normalized = { pluginId, manifest: normalizedManifest, files };
  assertCompleteConfigurePluginSnapshot(normalized);
  return normalized;
}

/**
 * Repairs only unambiguous shapes emitted by older prompts. Everything else is
 * checked against the advertised tool schema below instead of being silently
 * copied into a bundle and discarded by the manifest reader.
 */
function normalizeConfigurePluginManifestShorthand(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const manifest = { ...value };
  for (const ignored of ['featured', 'featuredOrder', 'featured_order']) delete manifest[ignored];
  if (manifest.schemaVersion === undefined && manifest.schema_version !== undefined) {
    manifest.schemaVersion = manifest.schema_version;
  }
  delete manifest.schema_version;

  const extension = objectOrNull(manifest.extension);
  if (manifest.uiCards !== undefined) {
    if (!extension) {
      throw new Error('manifest.uiCards requires manifest.extension; move it to manifest.extension.uiCards.');
    }
    if (extension.uiCards !== undefined) {
      throw new Error('Declare UI cards only once at manifest.extension.uiCards.');
    }
    manifest.extension = { ...extension, uiCards: manifest.uiCards };
    delete manifest.uiCards;
  }
  if (manifest.extension !== undefined) {
    manifest.extension = normalizeRendererUiContributionShorthand(manifest.extension);
  }
  return manifest;
}

export function configurePluginArgumentsPreview(input: PluginDraftInput, action: ConfigurePluginAction): string {
  return JSON.stringify({ action, manifest: input.manifest, files: input.files });
}

export function configurePluginResultPreview(input: PluginDraftInput, action: ConfigurePluginAction): string {
  const extension = objectOrNull(input.manifest.extension);
  return JSON.stringify({
    action,
    id: input.pluginId,
    name: input.manifest.name,
    version: input.manifest.version,
    publisher: input.manifest.publisher,
    capabilities: {
      tools: arrayLength(input.manifest.tools),
      skills: arrayLength(input.manifest.skills),
      mcpServers: arrayLength(input.manifest.mcpServers),
      hooks: arrayLength(input.manifest.hooks),
      resources: arrayLength(input.manifest.resources),
      extension: extension ? stringArray(extension.capabilities) : [],
      uiCards: arrayLength(extension?.uiCards),
      rendererUi: arrayLength(objectOrNull(extension?.rendererUi)?.contributions),
    },
    files: input.files.map((file) => ({
      path: file.path,
      bytes: Buffer.byteLength(file.content),
      sha256: createHash('sha256').update(file.content).digest('hex'),
    })),
  });
}

export function configurePluginIntegrityToken(input: PluginDraftInput, action: ConfigurePluginAction): string {
  const canonical = JSON.stringify(canonicalJson({ action, input }));
  return `configure-plugin:${createHash('sha256').update(canonical).digest('hex')}`;
}

export function configurePluginContainsExecutableCode(input: PluginDraftInput): boolean {
  return Boolean(input.manifest.extension) || arrayLength(input.manifest.hooks) > 0;
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  const normalized = jsonValue(value, label);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return normalized as Record<string, unknown>;
}

/** Enforces the `additionalProperties: false` boundary advertised to models. */
function assertNoUnknownSchemaProperties(
  value: unknown,
  schemaValue: unknown,
  path: string,
): void {
  const schema = objectOrNull(schemaValue);
  if (!schema) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoUnknownSchemaProperties(item, schema.items, `${path}[${index}]`);
    });
    return;
  }
  const record = objectOrNull(value);
  if (!record) return;

  const properties = objectOrNull(schema.properties) ?? {};
  if (schema.additionalProperties === false) {
    const unknown = Object.keys(record).filter((key) => !(key in properties));
    if (unknown.length) {
      throw new Error(`${path} contains unsupported ${unknown.length === 1 ? 'field' : 'fields'}: ${unknown.join(', ')}.`);
    }
  }
  for (const [key, item] of Object.entries(record)) {
    if (key in properties) assertNoUnknownSchemaProperties(item, properties[key], `${path}.${key}`);
  }
}

/**
 * Earlier prompts commonly placed these two fields beside `tree`. Repair only
 * that unambiguous AI-tool shorthand; bundle installation remains strict.
 */
function normalizeRendererUiContributionShorthand(value: unknown): unknown {
  const extension = objectOrNull(value);
  const rendererUi = objectOrNull(extension?.rendererUi);
  if (!extension || !rendererUi || rendererUi.schemaVersion !== 2 || !Array.isArray(rendererUi.contributions)) {
    return value;
  }
  let changed = false;
  const contributions = rendererUi.contributions.map((item) => {
    const contribution = objectOrNull(item);
    if (!contribution || contribution.data !== undefined || typeof contribution.stateKey !== 'string') return item;
    const declaredScopes = [contribution.scope, contribution.stateScope].filter((scope) => scope !== undefined);
    const scope = declaredScopes[0];
    if (
      declaredScopes.length !== 1
      || (scope !== 'global' && scope !== 'project' && scope !== 'thread')
    ) {
      return item;
    }
    const normalized = { ...contribution };
    delete normalized.stateKey;
    delete normalized.scope;
    delete normalized.stateScope;
    normalized.data = { stateKey: contribution.stateKey, scope };
    changed = true;
    return normalized;
  });
  return changed ? { ...extension, rendererUi: { ...rendererUi, contributions } } : value;
}

function jsonValue(value: unknown, label: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${label}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${label}.${key}`)]));
  }
  throw new Error(`${label} must contain only JSON values.`);
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]));
  }
  return value;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
