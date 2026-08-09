import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  PluginDraft,
  PluginDraftFileInput,
  PluginDraftInput,
  PluginDraftStore,
} from '../../ports/plugin-draft-store.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';
import { renameWithRetry } from '../store/json-file.js';
import {
  MAX_PLUGIN_FILES,
  MAX_PLUGIN_MANIFEST_BYTES,
  MAX_PLUGIN_TOTAL_BYTES,
  PLUGIN_MANIFEST_RELATIVE_PATH,
  inspectBundleTree,
  normalizePluginId,
  pathIsInside,
  readPluginManifest,
  safeRelativePath,
} from './file-plugin-bundle-model.js';

export class FilePluginDraftStore implements PluginDraftStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  pathFor(pluginId: string): string {
    return path.join(this.root, normalizePluginId(pluginId));
  }

  async writeDraft(input: PluginDraftInput): Promise<PluginDraft> {
    const pluginId = normalizePluginId(input.pluginId);
    const draftPath = this.pathFor(pluginId);
    return withFileStateUpdate(`${draftPath}.lock`, async () => {
      await mkdir(this.root, { recursive: true });
      assertManagedDraftPath(this.root, draftPath);

      const operationId = randomUUID();
      const stagingPath = path.join(this.root, `.${pluginId}.${operationId}.tmp`);
      const backupPath = path.join(this.root, `.${pluginId}.${operationId}.backup`);
      let existingMoved = false;
      let draftCommitted = false;

      try {
        await mkdir(stagingPath, { recursive: true });
        await writeDraftTree(stagingPath, input);
        const manifest = await readPluginManifest(stagingPath);
        if (manifest.id !== pluginId) {
          throw new Error(`Plugin draft id does not match its manifest: ${pluginId} != ${manifest.id}`);
        }
        await inspectBundleTree(stagingPath);

        const existing = await lstat(draftPath).catch(() => null);
        if (existing?.isSymbolicLink()) throw new Error(`Plugin draft path cannot be a symbolic link: ${pluginId}`);
        if (existing && !existing.isDirectory()) throw new Error(`Plugin draft path is not a directory: ${pluginId}`);
        if (existing) {
          await renameWithRetry(draftPath, backupPath);
          existingMoved = true;
        }
        await renameWithRetry(stagingPath, draftPath);
        draftCommitted = true;
        if (existingMoved) await rm(backupPath, { force: true, recursive: true }).catch(() => undefined);
        return { pluginId, path: draftPath };
      } catch (error) {
        if (existingMoved && !draftCommitted) {
          await renameWithRetry(backupPath, draftPath).catch((restoreError: unknown) => {
            throw new AggregateError([error, restoreError], `Failed to restore Plugin draft after update: ${pluginId}`);
          });
        }
        throw error;
      } finally {
        await rm(stagingPath, { force: true, recursive: true }).catch(() => undefined);
        if (draftCommitted) await rm(backupPath, { force: true, recursive: true }).catch(() => undefined);
      }
    });
  }
}

async function writeDraftTree(root: string, input: PluginDraftInput): Promise<void> {
  if (input.files.length + 1 > MAX_PLUGIN_FILES) {
    throw new Error(`Plugin draft exceeds ${MAX_PLUGIN_FILES} files.`);
  }
  const manifestText = `${JSON.stringify(input.manifest, null, 2)}\n`;
  const manifestBytes = Buffer.byteLength(manifestText);
  if (manifestBytes > MAX_PLUGIN_MANIFEST_BYTES) throw new Error('Plugin draft manifest is too large.');

  const files = normalizeDraftFiles(input.files);
  const totalBytes = files.reduce((total, file) => total + Buffer.byteLength(file.content), manifestBytes);
  if (totalBytes > MAX_PLUGIN_TOTAL_BYTES) throw new Error(`Plugin draft exceeds ${MAX_PLUGIN_TOTAL_BYTES} bytes.`);

  for (const file of files) {
    const target = path.resolve(root, file.path);
    if (!pathIsInside(root, target)) throw new Error(`Plugin draft file escapes the bundle: ${file.path}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, { encoding: 'utf8', flag: 'wx' });
  }

  const manifestPath = path.join(root, PLUGIN_MANIFEST_RELATIVE_PATH);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, manifestText, { encoding: 'utf8', flag: 'wx' });
}

function normalizeDraftFiles(files: PluginDraftFileInput[]): PluginDraftFileInput[] {
  const seen = new Set<string>();
  return files.map((file, index) => {
    const relativePath = safeRelativePath(file.path, `Plugin draft files[${index}].path`);
    const comparisonPath = relativePath.replaceAll('\\', '/').toLowerCase();
    if (comparisonPath === PLUGIN_MANIFEST_RELATIVE_PATH.replaceAll('\\', '/').toLowerCase()) {
      throw new Error('Plugin draft files cannot replace the generated manifest.');
    }
    if (seen.has(comparisonPath)) throw new Error(`Duplicate Plugin draft file: ${file.path}`);
    seen.add(comparisonPath);
    if (typeof file.content !== 'string') throw new Error(`Plugin draft files[${index}].content must be text.`);
    return { path: relativePath, content: file.content };
  });
}

function assertManagedDraftPath(root: string, target: string): void {
  if (!pathIsInside(root, target) || path.resolve(root) === path.resolve(target)) {
    throw new Error(`Plugin draft path escapes the managed root: ${target}`);
  }
}
