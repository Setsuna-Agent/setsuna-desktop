import { parseRuntimePluginUiManifest, parseSandboxedUiSource, type RuntimePluginUiDocumentReadResult } from '@setsuna-desktop/contracts';
import path from 'node:path';
import type { InstalledPluginRecord } from '../../ports/plugin-bundle-store.js';
import type { PluginAppProjectService } from '../plugin-app/project-service.js';
import { readBundleFileSnapshot } from './file-plugin-bundle-model.js';
import { decodePluginUiText } from './file-plugin-item-content.js';

export async function readPluginUiDocument(plugin: InstalledPluginRecord, contributionId: string,
  apps: PluginAppProjectService): Promise<RuntimePluginUiDocumentReadResult> {
  if (!plugin.extension?.capabilities.includes('ui') || !plugin.extension.trustedHash) {
    throw new Error(`Extension bundle is not trusted for Renderer UI: ${plugin.id}`);
  }
  const contribution = parseRuntimePluginUiManifest(plugin.extension.rendererUi).contributions.find(candidate =>
    candidate.id === contributionId && candidate.slot === 'renderer.plugin.page' && (candidate.document || candidate.reactApp));
  if (!contribution || (!contribution.document && !contribution.reactApp)) throw new Error(`Sandboxed Plugin page not found: ${plugin.id}/${contributionId}`);
  const document = contribution.document;
  const resourceIds = document ? [document.htmlResourceId, document.cssResourceId, document.jsResourceId]
    .filter((value): value is string => Boolean(value)) : [];
  const resources = resourceIds.map(resourceId => {
    const resource = plugin.resources.find(candidate => candidate.id === resourceId);
    if (!resource) throw new Error(`Plugin UI resource not found: ${plugin.id}/${resourceId}`);
    return resource;
  });
  const snapshot = await readBundleFileSnapshot(plugin.installPath, resources.map(resource => resource.path));
  if (snapshot.bundleHash !== plugin.extension.trustedHash) throw new Error(`Extension bundle is no longer trusted: ${plugin.id}`);
  if (contribution.reactApp) {
    // Opening an app only verifies and reads its published cache; it never starts Vite or an installer.
    return Object.freeze({ revision: snapshot.bundleHash, ...await apps.read(plugin, contribution.id) });
  }
  const sourceById = new Map(resources.map(resource => {
    const key = path.normalize(resource.path).split(path.sep).join('/');
    const content = snapshot.files.get(key);
    if (!content) throw new Error(`Plugin UI resource was not captured: ${plugin.id}/${resource.id}`);
    return [resource.id, decodePluginUiText(content, resource.id)] as const;
  }));
  const source = parseSandboxedUiSource({ html: sourceById.get(document!.htmlResourceId) ?? '',
    css: document!.cssResourceId ? sourceById.get(document!.cssResourceId) ?? '' : '',
    js: document!.jsResourceId ? sourceById.get(document!.jsResourceId) ?? '' : '' }, 'Plugin page source');
  return Object.freeze({ revision: snapshot.bundleHash, ...source });
}
