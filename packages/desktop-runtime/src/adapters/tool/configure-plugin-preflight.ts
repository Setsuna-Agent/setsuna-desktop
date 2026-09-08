import {
  parseRuntimePluginUiCardDeclarations,
  parseRuntimePluginUiManifest,
  RUNTIME_EXTENSION_API_VERSION,
  type RuntimeExtensionCapability,
  type RuntimePluginUiManifest,
} from '@setsuna-desktop/contracts';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Script } from 'node:vm';
import type { PluginDraftInput } from '../../ports/plugin-draft-store.js';
import {
  normalizeResourceId,
  pluginRootFileReferences,
  safeRelativePath,
} from '../plugin/file-plugin-bundle-model.js';

const EXTENSION_CAPABILITIES = new Set<RuntimeExtensionCapability>([
  'tools',
  'events',
  'ui',
  'state',
  'network',
]);
const MAX_REPORTED_ISSUES = 32;

type ResourceReference = Readonly<{ id: string; path: string }>;

/**
 * Validates references that are knowable from the in-memory complete snapshot.
 * This runs before approval so malformed AI drafts never ask the user to approve
 * a bundle that cannot possibly be installed.
 */
export function assertCompleteConfigurePluginSnapshot(input: PluginDraftInput): void {
  const issues: string[] = [];
  const addIssue = (message: string) => {
    if (issues.length < MAX_REPORTED_ISSUES && !issues.includes(message)) issues.push(message);
  };
  // configure_plugin canonicalizes draft file names before this preflight.
  // References must retain exact casing and separators so approval cannot pass
  // a snapshot that the real bundle reader will reject on a case-sensitive FS.
  const filesByPath = new Map(input.files.map((file) => [file.path, file.content]));
  const filePaths = new Set(filesByPath.keys());
  const requireFile = (rawPath: unknown, owner: string): string | null => {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      addIssue(`${owner} must name a bundle-relative file.`);
      return null;
    }
    try {
      const relativePath = safeRelativePath(rawPath.trim(), owner).split(path.sep).join('/');
      if (!filePaths.has(relativePath)) {
        addIssue(`files is missing ${owner}: ${relativePath}.`);
      }
      return relativePath;
    } catch (error) {
      addIssue(errorMessage(error));
      return null;
    }
  };

  const resources = validateResources(input.manifest.resources, requireFile, addIssue);
  validateSkills(input.manifest.skills, requireFile, addIssue);
  validatePluginRootReferences(input.manifest, requireFile, addIssue);
  validateExtension(
    input.manifest.extension,
    input.manifest.tools,
    resources,
    filesByPath,
    requireFile,
    addIssue,
  );

  if (!issues.length) return;
  const suffix = issues.length === MAX_REPORTED_ISSUES
    ? '\n- Additional issues were omitted.'
    : '';
  throw new Error([
    'configure_plugin snapshot is incomplete or invalid:',
    ...issues.map((issue) => `- ${issue}`),
    suffix,
    'Resubmit one complete manifest and files snapshot containing every referenced file. Do not finish with a promise to add files later.',
  ].filter(Boolean).join('\n'));
}

function validateResources(
  value: unknown,
  requireFile: (path: unknown, owner: string) => string | null,
  addIssue: (message: string) => void,
): ReadonlyMap<string, ResourceReference> {
  const resources = new Map<string, ResourceReference>();
  if (value === undefined) return resources;
  if (!Array.isArray(value)) {
    addIssue('manifest.resources must be an array.');
    return resources;
  }
  value.forEach((item, index) => {
    const record = objectOrNull(item);
    if (!record) {
      addIssue(`manifest.resources[${index}] must be an object.`);
      return;
    }
    if (typeof record.id !== 'string' || !record.id.trim()) {
      addIssue(`manifest.resources[${index}].id is required.`);
      return;
    }
    let id: string;
    try {
      id = normalizeResourceId(record.id);
    } catch (error) {
      addIssue(errorMessage(error));
      return;
    }
    if (resources.has(id)) {
      addIssue(`manifest.resources contains duplicate id: ${id}.`);
      return;
    }
    const resourcePath = requireFile(record.path, `manifest.resources[${index}].path`);
    if (resourcePath) resources.set(id, Object.freeze({ id, path: resourcePath }));
  });
  return resources;
}

function validateSkills(
  value: unknown,
  requireFile: (path: unknown, owner: string) => string | null,
  addIssue: (message: string) => void,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    addIssue('manifest.skills must be an array.');
    return;
  }
  value.forEach((skillPath, index) => {
    if (typeof skillPath !== 'string' || !skillPath.trim()) {
      addIssue(`manifest.skills[${index}] must be a bundle-relative directory.`);
      return;
    }
    requireFile(path.join(skillPath, 'SKILL.md'), `manifest.skills[${index}] SKILL.md`);
  });
}

function validatePluginRootReferences(
  manifest: Readonly<Record<string, unknown>>,
  requireFile: (path: unknown, owner: string) => string | null,
  addIssue: (message: string) => void,
): void {
  const references: string[] = [];
  for (const collection of [manifest.hooks, manifest.mcpServers, manifest.mcp_servers]) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      const record = objectOrNull(item);
      if (!record) continue;
      const args = Array.isArray(record.args)
        ? record.args.filter((arg): arg is string => typeof arg === 'string')
        : [];
      try {
        references.push(...pluginRootFileReferences([
          textOrUndefined(record.command),
          textOrUndefined(record.commandWindows ?? record.command_windows),
          ...args,
        ]));
      } catch (error) {
        addIssue(errorMessage(error));
      }
    }
  }
  for (const reference of new Set(references)) requireFile(reference, 'manifest {{pluginRoot}} reference');
}

function validateExtension(
  value: unknown,
  toolsValue: unknown,
  resources: ReadonlyMap<string, ResourceReference>,
  filesByPath: ReadonlyMap<string, string>,
  requireFile: (path: unknown, owner: string) => string | null,
  addIssue: (message: string) => void,
): void {
  if (value === undefined) return;
  const extension = objectOrNull(value);
  if (!extension) {
    addIssue('manifest.extension must be an object.');
    return;
  }
  if (extension.apiVersion !== RUNTIME_EXTENSION_API_VERSION) {
    addIssue(`manifest.extension.apiVersion must be ${RUNTIME_EXTENSION_API_VERSION}.`);
  }
  if (extension.runtime !== 'node-worker') {
    addIssue('manifest.extension.runtime must be "node-worker".');
  }
  const entry = requireFile(extension.entry, 'manifest.extension.entry');
  if (entry && path.extname(entry).toLowerCase() !== '.mjs') {
    addIssue('manifest.extension.entry must be an .mjs file.');
  } else if (entry && filesByPath.has(entry)) {
    validateModuleSyntax(filesByPath.get(entry)!, entry, addIssue);
  }

  const capabilities = validateCapabilities(extension.capabilities, addIssue);
  if (capabilities.has('network')) validateNetworkPolicy(extension.network, addIssue);
  else if (extension.network !== undefined) addIssue('manifest.extension.network requires the network capability.');

  if (extension.uiCards !== undefined) {
    try {
      const uiCards = parseRuntimePluginUiCardDeclarations(extension.uiCards);
      if (!capabilities.has('ui')) addIssue('manifest.extension.uiCards requires the ui capability.');
      const toolNames = new Set(
        (Array.isArray(toolsValue) ? toolsValue : [])
          .map((tool) => objectOrNull(tool)?.name)
          .filter((name): name is string => typeof name === 'string'),
      );
      for (const card of uiCards) {
        if (!toolNames.has(card.toolName)) {
          addIssue(`manifest.extension.uiCards references undeclared tool: ${card.toolName}.`);
        }
        validateClassicScriptSyntax(
          card.preview.js,
          `manifest.extension.uiCards preview ${card.id}`,
          addIssue,
        );
      }
    } catch (error) {
      addIssue(errorMessage(error));
    }
  }

  let rendererUi: RuntimePluginUiManifest | undefined;
  if (extension.rendererUi !== undefined) {
    try {
      rendererUi = parseRuntimePluginUiManifest(extension.rendererUi);
    } catch (error) {
      addIssue(errorMessage(error));
    }
    if (!capabilities.has('ui')) addIssue('manifest.extension.rendererUi requires the ui capability.');
  }
  if (rendererUi?.contributions.some((contribution) => contribution.data) && !capabilities.has('state')) {
    addIssue('manifest.extension.rendererUi data requires the state capability.');
  }
  for (const contribution of rendererUi?.contributions ?? []) {
    if (!contribution.document) continue;
    for (const resourceId of [
      contribution.document.htmlResourceId,
      contribution.document.cssResourceId,
      contribution.document.jsResourceId,
    ].filter((id): id is string => Boolean(id))) {
      if (!resources.has(resourceId)) {
        addIssue(`manifest.extension.rendererUi document references undeclared resource: ${resourceId}.`);
      }
    }
    const scriptResource = contribution.document.jsResourceId
      ? resources.get(contribution.document.jsResourceId)
      : undefined;
    if (scriptResource) {
      validateClassicScriptSyntax(
        filesByPath.get(scriptResource.path) ?? '',
        `Renderer UI JavaScript ${scriptResource.path}`,
        addIssue,
      );
    }
  }
}

function validateModuleSyntax(
  source: string,
  sourcePath: string,
  addIssue: (message: string) => void,
): void {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--check'],
    {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      input: source,
      maxBuffer: 64 * 1024,
      timeout: 5_000,
      windowsHide: true,
    },
  );
  if (result.error) {
    addIssue(`Could not validate ${sourcePath}: ${result.error.message}`);
    return;
  }
  if (result.status === 0) return;
  const diagnostic = result.stderr.trim().slice(0, 2_000) || `Node exited with status ${result.status ?? 'unknown'}.`;
  addIssue(`${sourcePath} is not valid JavaScript:\n${diagnostic}`);
}

function validateClassicScriptSyntax(
  source: string,
  label: string,
  addIssue: (message: string) => void,
): void {
  if (!source.trim()) return;
  try {
    new Script(source, { filename: label });
  } catch (error) {
    addIssue(`${label} is not valid JavaScript: ${errorMessage(error)}`);
  }
}

function validateCapabilities(
  value: unknown,
  addIssue: (message: string) => void,
): ReadonlySet<RuntimeExtensionCapability> {
  const capabilities = new Set<RuntimeExtensionCapability>();
  if (!Array.isArray(value) || !value.length) {
    addIssue('manifest.extension.capabilities must be a non-empty array.');
    return capabilities;
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string' || !EXTENSION_CAPABILITIES.has(item as RuntimeExtensionCapability)) {
      addIssue(`manifest.extension.capabilities[${index}] is unsupported.`);
      return;
    }
    const capability = item as RuntimeExtensionCapability;
    if (capabilities.has(capability)) addIssue(`manifest.extension.capabilities contains duplicate: ${capability}.`);
    capabilities.add(capability);
  });
  return capabilities;
}

function validateNetworkPolicy(value: unknown, addIssue: (message: string) => void): void {
  const network = objectOrNull(value);
  if (!network || !Array.isArray(network.allowedOrigins) || !network.allowedOrigins.length) {
    addIssue('manifest.extension.network.allowedOrigins must be a non-empty array.');
    return;
  }
  network.allowedOrigins.forEach((value, index) => {
    try {
      if (typeof value !== 'string') throw new Error('invalid');
      const url = new URL(value);
      if (
        (url.protocol !== 'http:' && url.protocol !== 'https:')
        || url.username
        || url.password
        || url.pathname !== '/'
        || url.search
        || url.hash
      ) throw new Error('invalid');
    } catch {
      addIssue(`manifest.extension.network.allowedOrigins[${index}] must be an exact HTTP(S) origin.`);
    }
  });
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
