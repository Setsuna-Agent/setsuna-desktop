import type { RuntimePluginConnector } from '@setsuna-desktop/contracts';
import { codexAppConnector } from './codex-app-connectors.js';
import { readPluginConnectors } from './plugin-connectors.js';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { convertCodexMcpServers } from './codex-plugin-mcp.js';
import { readCodexPluginIcon } from './codex-plugin-icon.js';
import { codexUnsupportedComponents } from './codex-plugin-components.js';
import { bundlePathExists, readPluginJson, safeExistingPath, safeRelativePath } from './file-plugin-bundle-paths.js';
import { objectRecord, optionalString, requiredString, stringArray } from './file-plugin-bundle-values.js';

export async function convertCodexPluginManifest(
  root: string,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const unsupportedComponents = await codexUnsupportedComponents(root, record);
  const id = requiredString(record.name, 'Codex plugin name');
  const presentation = record.interface === undefined ? {} : objectRecord(record.interface, 'Codex plugin interface must be an object.');
  const author = record.author === undefined ? {} : objectRecord(record.author, 'Codex plugin author must be an object.');
  const skills = await codexSkillPaths(root, record.skills);
  const mcp = await componentConfig(root, record.mcpServers, '.mcp.json', 'mcpServers');
  const mcpServers = mcp ? convertCodexMcpServers(mcp) : [];
  const apps = await componentConfig(root, record.apps, '.app.json', 'apps');
  const { unsupportedApps, alternatives } = optionalAppConnectors(apps, id, mcpServers);
  const explicit = await readPluginConnectors(root, record.connectors);
  const connectors = [...explicit, ...alternatives.filter((item) => !explicit.some((entry) => entry.id === item.id))];
  if (!skills.length && !mcpServers.length && !connectors.length) throw new Error('Codex plugin has no supported Skills, MCP servers or connectors.');
  return {
    schemaVersion: 2,
    id,
    name: optionalString(presentation.displayName) ?? id,
    iconImage: await readCodexPluginIcon(root, presentation),
    version: optionalString(record.version),
    description: optionalString(record.description) ?? optionalString(presentation.shortDescription),
    publisher: optionalString(author.name),
    tags: stringArray(record.keywords, 'Codex plugin keywords'),
    skills,
    mcpServers,
    connectors,
    ...(unsupportedApps.length ? { unsupportedApps } : {}),
    ...(unsupportedComponents.length ? { unsupportedComponents } : {}),
  };
}

async function componentConfig(
  root: string,
  value: unknown,
  defaultPath: string,
  field: string,
): Promise<Record<string, unknown> | undefined> {
  if (value === undefined && !await bundlePathExists(root, defaultPath)) return undefined;
  if (typeof value === 'string' || value === undefined) {
    const config = await readPluginJson(root, typeof value === 'string' ? value : defaultPath);
    return objectRecord(config[field], `Codex ${defaultPath} must contain ${field}.`);
  }
  return objectRecord(value, `Codex plugin ${field} must be a relative file path or an object.`);
}

function optionalAppConnectors(
  apps: Record<string, unknown> | undefined,
  pluginId: string,
  mcpServers: Record<string, unknown>[],
): { unsupportedApps: string[]; alternatives: RuntimePluginConnector[] } {
  const unsupportedApps: string[] = [];
  const alternatives: RuntimePluginConnector[] = [];
  const entries = Object.entries(apps ?? {});
  for (const [name, value] of entries) {
    const app = objectRecord(value, `Codex App ${name} must be an object.`);
    const appId = requiredString(app.id, `Codex App ${name}.id`);
    if (app.required !== undefined && typeof app.required !== 'boolean') {
      throw new Error(`Codex App ${name}.required must be a boolean.`);
    }
    // Published bundles often declare the same service through both a hosted App
    // and a direct MCP endpoint. Only that matching endpoint can replace an implicit dependency.
    const matchingMcp = mcpServers.find((server) => server.key === name)
      ?? (entries.length === 1 && /^app-[a-f0-9]+$/u.test(name) ? mcpServers.find((server) => server.key === pluginId) : undefined);
    if (app.required === true) {
      throw new Error(`Codex plugin explicitly requires an unsupported OpenAI App: ${name}.`);
    }
    if (app.required !== false && !matchingMcp) {
      throw new Error(`Codex plugin requires an unsupported OpenAI App: ${name}. No compatible bundled MCP alternative is available.`);
    }
    const connector = codexAppConnector(appId);
    if (connector) alternatives.push(connector);
    if (matchingMcp) {
      alternatives.push({
        id: `app-${matchingMcp.key}`, name: optionalString(matchingMcp.label) ?? String(matchingMcp.key),
        kind: 'mcp', serverKey: String(matchingMcp.key), required: app.required !== false,
      });
    } else if (!connector) {
      unsupportedApps.push(name);
    }
  }
  return { unsupportedApps, alternatives };
}

async function codexSkillPaths(root: string, value: unknown): Promise<string[]> {
  if (value === undefined && !await bundlePathExists(root, 'skills')) return [];
  const directories = value === undefined ? ['skills'] : typeof value === 'string'
    ? [value] : stringArray(value, 'Codex plugin skills');
  const skills = new Set<string>();
  for (const directory of directories) {
    const relativePath = safeRelativePath(directory, 'Codex Skill path');
    const directoryPath = await safeExistingPath(root, relativePath);
    if (!(await stat(directoryPath)).isDirectory()) throw new Error('Codex Skill path must be a directory.');
    if (await bundlePathExists(root, path.join(relativePath, 'SKILL.md'))) {
      skills.add(relativePath);
      continue;
    }
    for (const child of await readdir(directoryPath, { withFileTypes: true })) {
      if (!child.isDirectory() || child.isSymbolicLink()) continue;
      const childPath = path.join(relativePath, child.name);
      if (await bundlePathExists(root, path.join(childPath, 'SKILL.md'))) skills.add(childPath);
    }
  }
  return [...skills];
}
