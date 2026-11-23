import { workspaceFilePathKey, type WorkspaceFilePreview, type WorkspaceProjectRoot } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { parseAssetPath } from './document.js';
import { designImageExtensions, readDesignDocument, type DesignDocumentRef } from './operations.js';

export const designDirectoryGrants = 'design-directories';

export async function designDirectoryGrant(canonicalPath: string): Promise<DesignDirectory> {
  const key = workspaceFilePathKey(canonicalPath, '.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { id, path: canonicalPath };
}

export type DesignDirectory = Pick<WorkspaceProjectRoot, 'id' | 'path'>;
export type DesignCatalog = { directories: DesignDirectory[]; associations: { file: string; projectId: string | null }[] };
export type DesignImagePreview = Extract<WorkspaceFilePreview, { kind: 'image' }> | null;
const base = '/v1/features/design/storage';

function object(input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('Invalid design storage data.');
  return input as Record<string, unknown>;
}
function string(input: unknown): string {
  if (typeof input !== 'string' || !input) throw new Error('Invalid design storage value.');
  return input;
}
function project(input: unknown) { return input === null ? null : string(input); }
const ref = readDesignDocument.input;

export const getDesignCatalog = defineFeatureOperation({
  id: 'design.storage.catalog', path: base, method: 'GET', idempotency: 'safe', errors: {},
  input: defineRuntimeCodec(() => undefined), output: defineRuntimeCodec<DesignCatalog>((input) => {
    const { directories, associations } = object(input);
    if (!Array.isArray(directories) || !Array.isArray(associations)) throw new Error('Invalid design catalog.');
    return { directories: directories.map((item) => ({ id: string(item.id), path: string(item.path) })),
      associations: associations.map((item) => ({ file: string(item.file), projectId: project(item.projectId) })) };
  }),
});
export const setDesignProject = defineFeatureOperation({
  id: 'design.storage.project', path: base + '/project', method: 'POST', idempotency: 'idempotent',
  errors: { REVISION_CONFLICT: { status: 409 }, DESIGN_NOT_FOUND: { status: 404 }, DESIGN_RESOURCE_ROOT_UNAVAILABLE: { status: 409 } },
  input: defineRuntimeCodec((input) => {
    const value = object(input);
    return { ref: ref.parse(value.ref), documentId: string(value.documentId), projectId: project(value.projectId) };
  }), output: defineRuntimeCodec(() => null),
});
export const searchDesignImages = defineFeatureOperation({
  id: 'design.image.search', path: base + '/images/search', method: 'POST', idempotency: 'safe', errors: {},
  input: defineRuntimeCodec((input) => {
    const value = object(input);
    if (typeof value.query !== 'string') throw new Error('Invalid search query.');
    return { ref: ref.parse(value.ref), query: value.query };
  }), output: defineRuntimeCodec((input) => {
    if (!Array.isArray(input)) throw new Error('Invalid design image list.');
    return input.map(parseAssetPath);
  }),
});
export const readDesignImage = defineFeatureOperation({
  id: 'design.image.read', path: base + '/images/read', method: 'POST', idempotency: 'safe', errors: {},
  input: defineRuntimeCodec((input) => {
    const value = object(input);
    return { ref: ref.parse(value.ref), path: parseAssetPath(value.path) };
  }), output: defineRuntimeCodec<DesignImagePreview>((input) => {
    if (input === null) return null;
    const { kind, mimeType, base64 } = object(input);
    if (kind !== 'image' || typeof mimeType !== 'string' || !Object.hasOwn(designImageExtensions, mimeType)) throw new Error('Invalid design image.');
    return { kind, mimeType: mimeType as keyof typeof designImageExtensions, base64: string(base64) };
  }),
});

export interface DesignStorage {
  catalog(signal: AbortSignal): Promise<DesignCatalog>;
  setProject(ref: DesignDocumentRef, documentId: string, projectId: string | null, signal: AbortSignal): Promise<void>;
  searchImages(ref: DesignDocumentRef, query: string, signal: AbortSignal): Promise<string[]>;
  readImage(ref: DesignDocumentRef, path: string, signal: AbortSignal): Promise<DesignImagePreview>;
}
