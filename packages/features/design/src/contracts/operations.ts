import {
  isValidWorkspaceEntryName,
  MAX_WORKSPACE_IMAGE_BYTES,
  WORKSPACE_ENTRY_EXISTS_ERROR_CODE,
  type WorkspaceEntry,
  type WorkspaceFilePreviewImageMimeType,
} from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { designDocumentCodec, parseAssetPath, parseDesignEdit, type DesignDocument, type DesignEdit } from './document.js';
import { isDesignDocumentPath } from './design-resource-id.js';

export type DesignWorkspace = Readonly<{ projectId: string; rootId?: string }>;
export type DesignDocumentRef = DesignWorkspace & Readonly<{ path: string }>;
export type CreateDesignDocumentInput = DesignWorkspace & Readonly<{ parentPath: string; name: string }>;
export type DesignSnapshot = Readonly<{ document: DesignDocument; revision: string; canUndo: boolean; canRedo: boolean }>;

export const designImageExtensions = {
  'image/bmp': 'bmp', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/png': 'png',
  'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/x-icon': 'ico',
} as const satisfies Record<WorkspaceFilePreviewImageMimeType, string>;
export const designImageFileExtensions = [...Object.values(designImageExtensions), 'jpeg'] as const;
export type DesignImageExtension = (typeof designImageExtensions)[WorkspaceFilePreviewImageMimeType];
export type ImportDesignImageInput = Readonly<{ ref: DesignDocumentRef; name: string; base64: string }>;

const refCodec = defineRuntimeCodec<DesignDocumentRef>((input) => {
  const value = record(input);
  return { ...workspace(value), path: designPath(value.path) };
});

const imageImportCodec = defineRuntimeCodec<ImportDesignImageInput>((input) => {
  const value = record(input);
  const name = requiredString(value.name);
  if (/[\\/]/u.test(name) || name.includes('\0')) throw new Error('A design image requires a file name.');
  const base64 = value.base64;
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(MAX_WORKSPACE_IMAGE_BYTES / 3) * 4) {
    throw new Error('The design image is empty or too large.');
  }
  return { ref: refCodec.parse(value.ref), name, base64 };
});
const imagePathCodec = defineRuntimeCodec(parseAssetPath);

const createCodec = defineRuntimeCodec<CreateDesignDocumentInput>((input) => {
  const value = record(input);
  const name = requiredString(value.name);
  if (!isValidWorkspaceEntryName(name) || !isDesignDocumentPath(name)) throw new Error('Invalid design file name.');
  if (typeof value.parentPath !== 'string') throw new Error('Design parent path is required.');
  return { ...workspace(value), parentPath: value.parentPath, name };
});

const entryCodec = defineRuntimeCodec<WorkspaceEntry>((input) => {
  const value = record(input);
  if (value.type !== 'file') throw new Error('Expected a design file.');
  return { path: designPath(value.path), name: requiredString(value.name), type: 'file' };
});

const snapshotCodec = defineRuntimeCodec<DesignSnapshot>((input) => {
  const value = record(input);
  if (typeof value.canUndo !== 'boolean' || typeof value.canRedo !== 'boolean') throw new Error('Invalid design history state.');
  return {
    document: designDocumentCodec.parse(value.document),
    revision: requiredString(value.revision),
    canUndo: value.canUndo,
    canRedo: value.canRedo,
  };
});

type DesignMutation = Readonly<{ ref: DesignDocumentRef; expectedRevision: string }>;
export type CommitDesignEditsInput = DesignMutation & Readonly<{ edits: readonly DesignEdit[] }>;
export type NavigateDesignHistoryInput = DesignMutation & Readonly<{ direction: 'undo' | 'redo' }>;

const editCodec = defineRuntimeCodec<CommitDesignEditsInput>((input) => {
  const value = record(input);
  if (!Array.isArray(value.edits) || !value.edits.length) throw new Error('Design edits are required.');
  return { ...mutation(value), edits: value.edits.map(parseDesignEdit) };
});

const historyCodec = defineRuntimeCodec<NavigateDesignHistoryInput>((input) => {
  const value = record(input);
  if (value.direction !== 'undo' && value.direction !== 'redo') throw new Error('Invalid design history direction.');
  return { ...mutation(value), direction: value.direction };
});

const documentErrors = { INVALID_DESIGN_DOCUMENT: { status: 422 }, DESIGN_NOT_FOUND: { status: 404 } } as const;
const documentsRoute = '/v1/features/design/documents';

export const listDesignDocuments = defineFeatureOperation({
  id: 'design.document.list', path: `${documentsRoute}/list`, method: 'GET',
  input: defineRuntimeCodec<DesignWorkspace>((input) => workspace(record(input))),
  output: defineRuntimeCodec<readonly string[]>((input) => {
    if (!Array.isArray(input)) throw new Error('Expected a list of design files.');
    return input.map(designPath);
  }),
  errors: {}, idempotency: 'safe',
});

export const importDesignImage = defineFeatureOperation({
  id: 'design.image.import', path: '/v1/features/design/images', method: 'POST', input: imageImportCodec, output: imagePathCodec,
  errors: documentErrors, idempotency: 'non-idempotent',
});

export const createDesignDocument = defineFeatureOperation({
  id: 'design.document.create', path: documentsRoute, method: 'POST', input: createCodec, output: entryCodec,
  errors: { [WORKSPACE_ENTRY_EXISTS_ERROR_CODE]: { status: 409 } }, idempotency: 'non-idempotent',
});

export const readDesignDocument = defineFeatureOperation({
  id: 'design.document.read', path: documentsRoute, method: 'GET', input: refCodec, output: snapshotCodec,
  errors: documentErrors, idempotency: 'safe',
});

export const commitDesignEdits = defineFeatureOperation({
  id: 'design.document.edit', path: `${documentsRoute}/edits`, method: 'POST', input: editCodec, output: snapshotCodec,
  errors: documentErrors, idempotency: 'non-idempotent',
});

export const navigateDesignHistory = defineFeatureOperation({
  id: 'design.document.history', path: `${documentsRoute}/history`, method: 'POST', input: historyCodec, output: snapshotCodec,
  errors: documentErrors, idempotency: 'non-idempotent',
});

function mutation(value: Record<string, unknown>): DesignMutation {
  return { ref: refCodec.parse(value.ref), expectedRevision: requiredString(value.expectedRevision) };
}

function workspace(value: Record<string, unknown>): DesignWorkspace {
  return { projectId: requiredString(value.projectId), ...(value.rootId === undefined ? {} : { rootId: requiredString(value.rootId) }) };
}

function designPath(value: unknown): string {
  const path = requiredString(value);
  if (!isDesignDocumentPath(path)) throw new Error('Expected a .design.json path.');
  return path;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A non-empty design reference is required.');
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid design operation data.');
  return value as Record<string, unknown>;
}
