import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { parseAssetPath } from './document.js';

export type DesignCleanupSelection = Readonly<{ path: string; revision: string }>;
export type LocalDesignFile = DesignCleanupSelection & Readonly<{ bytes: number }> & (
  | Readonly<{ kind: 'document'; libraryPaths?: readonly string[] }>
  | Readonly<{ kind: 'asset' }>
);
export type LocalDesignInventory = Readonly<{ files: readonly LocalDesignFile[]; incomplete: boolean }>;

function selection(input: unknown): DesignCleanupSelection {
  const value = input as Partial<DesignCleanupSelection> | null;
  if (typeof value?.revision !== 'string' || !value.revision) throw new Error('Missing design file revision.');
  return { path: parseAssetPath(value.path), revision: value.revision };
}

const route = '/v1/features/design/storage/local-files';
export const listLocalDesignFiles = defineFeatureOperation({
  id: 'design.storage.local-files', path: route, method: 'GET', idempotency: 'safe', errors: {},
  input: defineRuntimeCodec(() => undefined),
  output: defineRuntimeCodec<LocalDesignInventory>((input) => {
    const value = input as Partial<LocalDesignInventory> | null;
    if (!Array.isArray(value?.files) || typeof value.incomplete !== 'boolean') throw new Error('Invalid design inventory.');
    return { incomplete: value.incomplete, files: value.files.map((file: LocalDesignFile) => {
      if ((file.kind !== 'document' && file.kind !== 'asset') || !Number.isSafeInteger(file.bytes) || file.bytes < 0) {
        throw new Error('Invalid local design file.');
      }
      const entry = { ...selection(file), bytes: file.bytes };
      if (file.kind === 'asset') return { ...entry, kind: 'asset' };
      if (file.libraryPaths !== undefined && !Array.isArray(file.libraryPaths)) throw new Error('Invalid local design libraries.');
      return { ...entry, kind: 'document', ...(file.libraryPaths && { libraryPaths: file.libraryPaths.map(parseAssetPath) }) };
    }) };
  }),
});

export const removeUnusedDesignAssets = defineFeatureOperation({
  id: 'design.storage.remove-unused-assets', path: route + '/remove-unused-assets', method: 'POST', idempotency: 'idempotent', errors: {},
  input: defineRuntimeCodec((input): { assets: DesignCleanupSelection[] } => {
    const assets = (input as { assets?: unknown } | null)?.assets;
    if (!Array.isArray(assets)) throw new Error('Invalid design asset selection.');
    return { assets: assets.map(selection) };
  }),
  output: defineRuntimeCodec<readonly string[]>((input) => {
    if (!Array.isArray(input)) throw new Error('Invalid design cleanup result.');
    return input.map(parseAssetPath);
  }),
});
