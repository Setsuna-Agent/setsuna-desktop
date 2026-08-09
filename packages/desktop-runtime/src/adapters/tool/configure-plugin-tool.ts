import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import type { PluginDraftInput } from '../../ports/plugin-draft-store.js';
import {
  PLUGIN_MANIFEST_RELATIVE_PATH,
  normalizePluginId,
  safeRelativePath,
} from '../plugin/file-plugin-bundle-model.js';
import { objectInput, requiredStringArg } from './tool-input.js';

export const CONFIGURE_PLUGIN_TOOL = 'configure_plugin';
export const MAX_CONFIGURE_PLUGIN_FILES = 64;
export const MAX_CONFIGURE_PLUGIN_TEXT_BYTES = 512 * 1024;

export type ConfigurePluginAction = 'create' | 'update';

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
            description: 'Declared text resources present in files.',
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
            description: 'Optional executable Node worker extension.',
            properties: {
              apiVersion: { type: 'integer', enum: [1] },
              runtime: { type: 'string', enum: ['node-worker'] },
              entry: { type: 'string', description: 'Relative JavaScript entry file present in files.' },
              capabilities: {
                type: 'array',
                items: { type: 'string', enum: ['tools', 'events', 'ui', 'state'] },
              },
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
  const manifest = jsonObject(args.manifest, 'manifest');
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
  return { pluginId, manifest: normalizedManifest, files };
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
