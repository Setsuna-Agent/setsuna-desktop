import { createHash } from 'node:crypto';
import path from 'node:path';
import { designPackageContentPrefix, designPackageManifestFile, designPackageResourceRoot, designPackageStagingFile, designPackageStagingPrefix, findBundledDesignLibrary,
  maxDesignPackageContentBytes, maxDesignPackageManifestBytes, maxDesignPackagePreviewEntries,
  type DesignDocument, type DesignPackageManifest, type DesignPackageReceipt, type PrepareDesignPackageInput } from '@setsuna-desktop/feature-design/contracts';
import { designPackageDependencies, designPackageFileLimits, designPackageTooLarge,
  parseDesignPackageText, readDesignPackageImageType } from './design-package-dependencies.js';
import { designPackageChunks, readDesignPackageFile, verifyDesignPackageFiles, type DesignPackageFile } from './design-package-files.js';
import { writeDesignZip } from './design-package-zip.js';
import { designChanged } from './design-workspace-document-file.js';
import { resolveExistingWorkspaceEntry } from './workspace-entry-mutations.js';
import { readWorkspaceFilePrefix } from './workspace-file-preview-reader.js';

type Source = Readonly<{ root: string; entry: string }>;
type BuiltinLibrary = DesignPackageManifest['externalDependencies']['builtinLibraries'][number];

export async function stageDesignPackage(directory: string, input: PrepareDesignPackageInput, source: Source,
  builtinRevision: (path: string) => Promise<string>, signal: AbortSignal): Promise<DesignPackageReceipt> {
  const staging = await resolveExistingWorkspaceEntry(directory, designPackageStagingPrefix + input.ticket);
  if (!staging.stats.isDirectory()) throw new Error('The design package destination is unavailable.');
  const target = path.join(staging.target, designPackageStagingFile);
  const { root, entry } = source;
  const dependencies = designPackageDependencies(entry, input.documentId);
  const files: DesignPackageFile[] = [];
  const fonts = new Set<string>();
  const webUrls = new Set<string>();
  const builtins = new Map<string, BuiltinLibrary>();
  let inputBytes = 0;

  async function collectExternalDependencies(document: DesignDocument) {
    for (const layer of Object.values(document.nodes)) {
      if (layer.kind === 'web' && layer.url) webUrls.add(layer.url);
      if (layer.kind === 'text') {
        if (layer.fontFamily) fonts.add(layer.fontFamily);
        for (const run of layer.runs ?? []) if (run.fontFamily) fonts.add(run.fontFamily);
      }
    }
    for (const style of Object.values(document.styles ?? {})) {
      if (style.kind === 'text' && style.typography.fontFamily) fonts.add(style.typography.fontFamily);
    }
    for (const [documentId, path] of Object.entries(document.libraries ?? {})) {
      if (findBundledDesignLibrary(path) && !builtins.has(path)) builtins.set(path, { path, documentId, revision: await builtinRevision(path) });
    }
  }

  await writeDesignZip(target, signal, async (append) => {
    // Library discovery appends to this map. Each relative path is visited once, including cycles.
    for (const dependency of dependencies.files.values()) {
      const { path, kind } = dependency;
      const { entry: file, value: document } = await readDesignPackageFile(root, path, signal, async (file, size) => {
        inputBytes += size;
        if (size > designPackageFileLimits[kind] || inputBytes > maxDesignPackageContentBytes) throw designPackageTooLarge();
        if (kind === 'image') {
          const mime = await readDesignPackageImageType(file, size);
          const hash = createHash('sha256');
          async function* bytes() {
            for await (const chunk of designPackageChunks(file, size, signal)) {
              hash.update(chunk);
              yield chunk;
            }
          }
          await append(designPackageContentPrefix + path, bytes(), mime === 'image/svg+xml');
          return { revision: hash.digest('hex'), value: undefined };
        }
        const bytes = await readWorkspaceFilePrefix(file, size);
        const revision = createHash('sha256').update(bytes).digest('hex');
        if (path === entry && revision !== input.expectedRevision) throw designChanged();
        const parsed = parseDesignPackageText(dependency, bytes);
        await append(designPackageContentPrefix + path, [bytes]);
        return { revision, value: parsed };
      });
      files.push(file);
      if (document) {
        dependencies.collect(document);
        await collectExternalDependencies(document);
      }
    }
    const manifest: DesignPackageManifest = {
      formatVersion: 1, entry: designPackageContentPrefix + entry, resourceRoot: designPackageResourceRoot,
      externalDependencies: { webUrls: [...webUrls].sort(), builtinLibraries: [...builtins.values()],
        fonts: { source: 'environment', declaredFamilies: [...fonts].sort() } },
    };
    await verifyDesignPackageFiles(root, files, signal);
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    if (bytes.length > maxDesignPackageManifestBytes) throw designPackageTooLarge();
    await append(designPackageManifestFile, [bytes]);
  });
  const entries = [designPackageManifestFile];
  for (const path of dependencies.files.keys()) {
    if (entries.length >= maxDesignPackagePreviewEntries) break;
    entries.push(designPackageContentPrefix + path);
  }
  return { ticket: input.ticket, archive: { entries, remaining: 1 + dependencies.files.size - entries.length } };
}
