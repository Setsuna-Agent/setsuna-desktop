import type { FileHandle } from 'node:fs/promises';
import { detectWorkspacePreviewImageMimeType, MAX_WORKSPACE_IMAGE_BYTES, WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES } from '@setsuna-desktop/contracts';
import { designDocumentCodec, designDocumentImagePaths, designLayerShaderPaths, designLibraryFileLinks, isPortableDesignPackagePathPart,
  maxDesignPackageFiles, maxDesignScriptBytes, maxDesignShaderBytes, parseDesignScriptSource, parseDesignShaderSource,
  type DesignDocument } from '@setsuna-desktop/feature-design/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { readWorkspaceFilePrefix } from './workspace-file-preview-reader.js';

export type DesignPackageDependency = Readonly<{ kind: 'document'; path: string; documentId?: string }>
  | Readonly<{ kind: 'image' | 'script' | 'shader'; path: string }>;
export type DesignPackagePaths = Map<string, { path: string; directory: boolean }>;
export const designPackageFileLimits = { document: WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES, image: MAX_WORKSPACE_IMAGE_BYTES,
  script: maxDesignScriptBytes, shader: maxDesignShaderBytes };

export function designPackageDependencies(entry: string, documentId?: string) {
  const files = new Map<string, DesignPackageDependency>();
  const paths: DesignPackagePaths = new Map();
  function add(dependency: DesignPackageDependency) {
    const previous = files.get(dependency.path);
    if (previous) {
      if (previous.kind !== dependency.kind || (previous.kind === 'document' && dependency.kind === 'document'
        && previous.documentId !== undefined && dependency.documentId !== undefined && previous.documentId !== dependency.documentId)) {
        throw new FeatureOperationFailure({
          code: 'DESIGN_DEPENDENCY_UNAVAILABLE', message: `Conflicting references to "${dependency.path}".`, retryable: false,
        });
      }
      return;
    }
    if (files.size >= maxDesignPackageFiles) throw designPackageTooLarge();
    reserveDesignPackagePath(dependency.path, paths);
    files.set(dependency.path, dependency);
  }
  function collect(document: DesignDocument) {
    // Set the actual entry ID before following references back to this document.
    const primary = files.get(entry);
    if (primary?.kind === 'document' && primary.documentId === undefined) files.set(entry, { ...primary, documentId: document.documentId });
    for (const path of designDocumentImagePaths(document)) add({ path, kind: 'image' });
    for (const layer of Object.values(document.nodes)) {
      if (layer.kind === 'script' && layer.scriptPath) add({ path: layer.scriptPath, kind: 'script' });
      for (const path of designLayerShaderPaths(layer)) add({ path, kind: 'shader' });
    }
    for (const [documentId, path] of designLibraryFileLinks(document.libraries)) add({ path, kind: 'document', documentId });
  }
  add({ kind: 'document', path: entry, documentId });
  return { files, collect };
}

export function reserveDesignPackagePath(value: string, paths: DesignPackagePaths) {
  if (Buffer.byteLength(value) > 4096) throw invalidPath(value);
  const parts = value.split('/');
  let prefix = '';
  for (const [index, part] of parts.entries()) {
    if (!isPortableDesignPackagePathPart(part)) throw invalidPath(value);
    prefix = prefix ? `${prefix}/${part}` : part;
    const key = prefix.normalize('NFC').toLowerCase().normalize('NFC');
    const directory = index < parts.length - 1;
    const existing = paths.get(key);
    if (existing && (existing.path !== prefix || existing.directory !== directory)) throw invalidPath(value);
    if (!existing) {
      if (paths.size >= maxDesignPackageFiles * 4) throw designPackageTooLarge();
      paths.set(key, { path: prefix, directory });
    }
  }
}

export async function readDesignPackageImageType(file: FileHandle, size: number) {
  const mime = detectWorkspacePreviewImageMimeType(await readWorkspaceFilePrefix(file, Math.min(size, 64 * 1024)));
  if (!mime) throw new Error('Expected image data.');
  return mime;
}

export function parseDesignPackageText(dependency: DesignPackageDependency, bytes: Buffer) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (dependency.kind === 'script') parseDesignScriptSource(text);
  else if (dependency.kind === 'shader') parseDesignShaderSource(text);
  else if (dependency.kind === 'document') {
    const document = designDocumentCodec.parse(JSON.parse(text));
    if (dependency.documentId !== undefined && document.documentId !== dependency.documentId) throw new Error('The design library ID does not match.');
    return document;
  }
}

function invalidPath(path: string) {
  return new FeatureOperationFailure({
    code: 'DESIGN_PACKAGE_INVALID_PATH', message: `"${path}" conflicts with another path or cannot be unpacked on macOS and Windows.`, retryable: false,
  });
}

export function designPackageTooLarge() {
  return new FeatureOperationFailure({
    code: 'DESIGN_PACKAGE_TOO_LARGE', message: 'The design package exceeds the ZIP size limit.', retryable: false,
  });
}
