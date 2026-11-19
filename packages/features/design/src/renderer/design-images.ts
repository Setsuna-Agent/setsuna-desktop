import { detectWorkspacePreviewImageMimeType, MAX_WORKSPACE_IMAGE_BYTES, type DesktopWorkspaceEntriesWatchOptions } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { readImageFile } from '@setsuna-desktop/renderer-ui';
import { useEffect, useMemo, useState } from 'react';
import { designImageExtensions, designImageFileExtensions, parseAssetPath, type DesignDocument, type DesignDocumentRef, type DesignNode } from '../contracts/index.js';
import type { DesignAssets, DesignClient } from './client.js';

export type LoadDesignImage = (path: string, options?: { fresh?: boolean }) => Promise<HTMLImageElement>;
export type WatchDesignDirectories = (directories: readonly string[], changed: () => void, options?: DesktopWorkspaceEntriesWatchOptions) => () => void;
export type PreparedDesignImage = Readonly<{ name: string; src: string }>;
type DesignImageImport = Readonly<{
  ref: DesignDocumentRef;
  store: DesignClient['importImage'];
  signal: AbortSignal;
  translate: RendererTranslate;
}>;
const imageExtensions = new Set<string>(designImageFileExtensions);
export const designImageAccept = Array.from(imageExtensions, (extension) => `.${extension}`).join(',');

export function isDesignImageName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && imageExtensions.has(name.slice(dot + 1).toLowerCase());
}

export function clipboardDesignImage(clipboard: DataTransfer): File | undefined {
  return Array.from(clipboard.files).find(({ name, type }) => type.toLowerCase().startsWith('image/') || isDesignImageName(name));
}

export function designLayerImagePaths(node: DesignNode, visibleOnly = false): readonly string[] {
  if (node.kind === 'image') return [node.assetPath];
  return node.fills?.flatMap((fill) => fill.image && (!visibleOnly || !fill.hidden && fill.opacity !== 0) ? [fill.image.assetPath] : []) ?? [];
}

function createDesignImageLoader(assets: Pick<DesignAssets, 'read'>, ref: DesignDocumentRef): LoadDesignImage {
  const images = new Map<string, Promise<HTMLImageElement>>();
  return async (path, options) => {
    const existing = images.get(path);
    if (!options?.fresh && existing) return existing;
    const result = assets.read(ref, parseAssetPath(path)).then((asset) => {
      if (!asset) throw new Error('The project file has no image preview.');
      return decodeDesignImage(`data:${asset.mimeType};base64,${asset.base64}`);
    }).catch((error: unknown) => {
      if (images.get(path) === result) images.delete(path);
      throw error;
    });
    images.set(path, result);
    if (images.size > 16) {
      const oldest = images.keys().next().value;
      if (oldest !== undefined) images.delete(oldest);
    }
    return result;
  };
}

export function useDesignImageLoader(
  assets: Pick<DesignAssets, 'read'>, ref: DesignDocumentRef, document: DesignDocument | null, watchDirectories?: WatchDesignDirectories,
): LoadDesignImage {
  const [generation, setGeneration] = useState(0);
  const directoryKey = useMemo(() => {
    const directories = new Set<string>();
    for (const node of Object.values(document?.nodes ?? {})) {
      for (const path of designLayerImagePaths(node)) {
        const slash = path.lastIndexOf('/');
        directories.add(slash === -1 ? '.' : path.slice(0, slash));
      }
    }
    return JSON.stringify([...directories].sort());
  }, [document]);
  useEffect(() => {
    const directories = JSON.parse(directoryKey) as string[];
    if (!directories.length) return;
    const changed = () => setGeneration((current) => current + 1);
    const unwatch = watchDirectories?.(directories, changed);
    window.addEventListener('focus', changed);
    return () => {
      window.removeEventListener('focus', changed);
      unwatch?.();
    };
  }, [directoryKey, watchDirectories]);
  // A new loader keeps in-flight reads from the old cache out of the refreshed canvas.
  return useMemo(() => createDesignImageLoader(assets, ref), [assets, generation, ref]);
}

export async function prepareLocalDesignImage(file: File, signal: AbortSignal, t: RendererTranslate): Promise<PreparedDesignImage> {
  const tooLarge = t('feature.design.importImageTooLarge', { size: MAX_WORKSPACE_IMAGE_BYTES / (1024 * 1024) });
  if (file.size > MAX_WORKSPACE_IMAGE_BYTES) throw new Error(tooLarge);
  const readError = t('feature.design.importImageFailed', { path: file.name || t('feature.design.image') });
  const invalid = t('feature.design.importImageInvalid');
  const header = await file.slice(0, 64 * 1024).arrayBuffer().catch((error: unknown) => {
    throw new Error(readError, { cause: error });
  });
  const mimeType = detectWorkspacePreviewImageMimeType(new Uint8Array(header));
  if (!mimeType) throw new Error(invalid);
  signal.throwIfAborted();
  const normalized = file.type === mimeType ? file : new File([file], file.name, { type: mimeType });
  const dataUrl = await readImageFile(normalized, {
    maxBytes: MAX_WORKSPACE_IMAGE_BYTES, mimeTypes: [mimeType],
    copy: { emptyFile: invalid, invalidType: invalid, readError, tooLarge },
  });
  signal.throwIfAborted();
  await decodeDesignImage(dataUrl).catch((error: unknown) => { throw new Error(invalid, { cause: error }); });
  signal.throwIfAborted();
  return { name: file.name.trim() || `image.${designImageExtensions[mimeType]}`, src: dataUrl };
}

export async function storePreparedDesignImage({ name, src }: PreparedDesignImage, { ref, store, signal, translate: t }: DesignImageImport): Promise<string> {
  signal.throwIfAborted();
  const base64 = src.slice(src.indexOf(',') + 1);
  return store({ ref, name, base64 }, signal).catch((error: unknown) => {
    throw new Error(t('feature.design.importImageFailed', { path: name }), { cause: error });
  });
}

export async function importLocalDesignImage(file: File, options: DesignImageImport): Promise<string> {
  return storePreparedDesignImage(await prepareLocalDesignImage(file, options.signal, options.translate), options);
}

async function decodeDesignImage(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = source;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('The image has no intrinsic dimensions.');
  return image;
}
