import {
  isValidWorkspaceEntryName,
  MAX_WORKSPACE_IMAGE_BYTES,
  WORKSPACE_ENTRY_EXISTS_ERROR_CODE,
  type WorkspaceEntry,
  type WorkspaceFilePreviewImageMimeType,
} from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { parseDesignScriptName, parseDesignScriptPath, parseDesignScriptSource } from './design-content-source.js';
import { designDocumentCodec, parseAssetPath, parseDesignEdit, type DesignDocument, type DesignEdit } from './document.js';
import { designLibraryPresets, findBundledDesignLibrary, type DesignLibraryPresetId } from './design-library-presets.js';
import { isDesignDocumentPath } from './design-resource-id.js';
import { parseDesignScriptInputs, parseDesignScriptParameters, type DesignScriptInputs } from './design-script-parameters.js';
import { parseDesignShaderName, parseDesignShaderPath, parseDesignShaderSource } from './design-shader.js';
import { designCommandFromQuery, designCommandQuery, readDesignCommandKey, type DesignCommandKey } from './design-command-key.js';

export type DesignWorkspace = Readonly<{ projectId: string; rootId?: string; storageId?: never }>
  | Readonly<{ storageId: string; projectId?: never; rootId?: never }>;

export function designFileKey(ref: DesignDocumentRef): string {
  return JSON.stringify([ref.projectId ?? null, ref.storageId ?? ref.rootId ?? null, ref.path]);
}

export function parseDesignWorkspace(input: unknown): DesignWorkspace {
  return workspace(record(input));
}
export type DesignDocumentRef = DesignWorkspace & Readonly<{ path: string }>;
export type ListDesignDocumentEntriesInput = DesignWorkspace & Readonly<{ includePreviewMetadata?: true }>;
export type DesignDocumentListEntry = Readonly<{ path: string; modifiedAt?: string; revision?: string; libraryPreset?: true }>;
export type CreateDesignDocumentInput = DesignWorkspace & Readonly<{
  parentPath: string; name: string; autoNumber?: boolean; linkedProjectId?: string; command?: DesignCommandKey;
}>;
export type PrepareDesignLibraryPresetInput = Readonly<{ ref: DesignDocumentRef; presetId: DesignLibraryPresetId }>;
export type MoveDesignDocumentInput = Readonly<{ ref: DesignDocumentRef; destination: DesignWorkspace; command?: DesignCommandKey; expectedRevision?: string }>;
export type DesignSnapshot = Readonly<{ document: DesignDocument; revision: string; canUndo: boolean; canRedo: boolean; workspaceRoot?: string; linkedProjectId?: string | null }>;

export const designImageExtensions = {
  'image/bmp': 'bmp', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/png': 'png',
  'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/x-icon': 'ico',
} as const satisfies Record<WorkspaceFilePreviewImageMimeType, string>;
export const designImageFileExtensions = [...Object.values(designImageExtensions), 'jpeg'] as const;
export type DesignImageExtension = (typeof designImageExtensions)[WorkspaceFilePreviewImageMimeType];
export type ImportDesignImageInput = Readonly<{ ref: DesignDocumentRef; name: string; base64: string }>;
export type ImportDesignScriptInput = Readonly<{ ref: DesignDocumentRef; name: string; source: string }>;
export type ImportDesignShaderInput = ImportDesignScriptInput;
export type ReadDesignShaderInput = DesignDocumentRef & Readonly<{ shaderPath: string }>;
export type ReadDesignScriptParametersInput = DesignDocumentRef & Readonly<{ scriptPath: string }>;
export type RenderDesignScriptInput = Readonly<{ ref: DesignDocumentRef; scriptPath: string; width: number; height: number;
  inputs?: DesignScriptInputs }>;

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
  if (value.autoNumber !== undefined && typeof value.autoNumber !== 'boolean') throw new Error('Invalid design numbering option.');
  return { ...workspace(value), parentPath: value.parentPath, name, command: readDesignCommandKey(value.command),
    ...(value.autoNumber ? { autoNumber: true } : {}),
    ...(value.linkedProjectId === undefined ? {} : { linkedProjectId: requiredString(value.linkedProjectId) }) };
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
    ...(value.workspaceRoot === undefined ? {} : { workspaceRoot: requiredString(value.workspaceRoot) }),
    ...(value.linkedProjectId === undefined ? {} : { linkedProjectId: value.linkedProjectId === null ? null : requiredString(value.linkedProjectId) }),
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
const resourceRootErrors = { DESIGN_RESOURCE_ROOT_AMBIGUOUS: { status: 409 }, DESIGN_RESOURCE_ROOT_UNAVAILABLE: { status: 409 } } as const;
const scriptErrors = { DESIGN_SCRIPT_FAILED: { status: 422 } } as const;
const documentsRoute = '/v1/features/design/documents';
const designListingErrors = { DESIGN_PROJECT_DIRECTORY_UNAVAILABLE: { status: 409 } } as const;

export const listDesignDocuments = defineFeatureOperation({
  id: 'design.document.list', path: `${documentsRoute}/list`, method: 'GET',
  input: defineRuntimeCodec<DesignWorkspace>((input) => workspace(record(input))),
  output: defineRuntimeCodec<readonly string[]>((input) => {
    if (!Array.isArray(input)) throw new Error('Expected a list of design files.');
    return input.map(designPath);
  }),
  errors: designListingErrors, idempotency: 'safe',
});

export const listDesignDocumentEntries = defineFeatureOperation({
  id: 'design.document.entries', path: `${documentsRoute}/entries`, method: 'GET',
  input: defineRuntimeCodec<ListDesignDocumentEntriesInput>((input) => {
    const value = record(input);
    const scope = workspace(value);
    return value.includePreviewMetadata === true || value.includePreviewMetadata === 'true' ? { ...scope, includePreviewMetadata: true } : scope;
  }),
  output: defineRuntimeCodec<readonly DesignDocumentListEntry[]>((input) => {
    if (!Array.isArray(input)) throw new Error('Expected a list of design entries.');
    return input.map((entry) => {
      const { path, modifiedAt, revision, libraryPreset } = record(entry);
      if (modifiedAt !== undefined && (typeof modifiedAt !== 'string' || !Number.isFinite(Date.parse(modifiedAt)))) {
        throw new Error('Invalid design modification time.');
      }
      return { path: designPath(path), ...(modifiedAt === undefined ? {} : { modifiedAt }),
        ...(revision === undefined ? {} : { revision: requiredString(revision) }),
        ...(libraryPreset === true ? { libraryPreset: true } : {}) };
    });
  }),
  errors: designListingErrors, idempotency: 'safe',
});

export const importDesignImage = defineFeatureOperation({
  id: 'design.image.import', path: '/v1/features/design/images', method: 'POST', input: imageImportCodec, output: imagePathCodec,
  errors: { ...documentErrors, ...resourceRootErrors }, idempotency: 'non-idempotent',
});

export const importDesignScript = defineFeatureOperation({
  id: 'design.script.import', path: '/v1/features/design/scripts', method: 'POST',
  input: defineRuntimeCodec<ImportDesignScriptInput>((input) => {
    const { ref, name, source } = record(input);
    return { ref: refCodec.parse(ref), name: parseDesignScriptName(name), source: parseDesignScriptSource(source) };
  }),
  output: defineRuntimeCodec(parseDesignScriptPath),
  errors: { ...documentErrors, ...resourceRootErrors }, idempotency: 'non-idempotent',
});

const shadersRoute = '/v1/features/design/shaders';
export const importDesignShader = defineFeatureOperation({
  id: 'design.shader.import', path: shadersRoute, method: 'POST',
  input: defineRuntimeCodec<ImportDesignShaderInput>((input) => {
    const { ref, name, source } = record(input);
    return { ref: refCodec.parse(ref), name: parseDesignShaderName(name), source: parseDesignShaderSource(source) };
  }),
  output: defineRuntimeCodec(parseDesignShaderPath),
  errors: { ...documentErrors, ...resourceRootErrors }, idempotency: 'non-idempotent',
});

export const readDesignShader = defineFeatureOperation({
  id: 'design.shader.read', path: shadersRoute, method: 'GET',
  input: defineRuntimeCodec<ReadDesignShaderInput>((input) => {
    const value = record(input);
    return { ...refCodec.parse(value), shaderPath: parseDesignShaderPath(value.shaderPath) };
  }),
  output: defineRuntimeCodec(parseDesignShaderSource),
  errors: { ...documentErrors, DESIGN_SHADER_FAILED: { status: 422 } }, idempotency: 'safe',
});

export const readDesignScriptParameters = defineFeatureOperation({
  id: 'design.script.parameters', path: '/v1/features/design/scripts/parameters', method: 'GET',
  input: defineRuntimeCodec<ReadDesignScriptParametersInput>((input) => {
    const value = record(input);
    return { ...refCodec.parse(value), scriptPath: parseDesignScriptPath(value.scriptPath) };
  }),
  output: defineRuntimeCodec(parseDesignScriptParameters),
  errors: scriptErrors, idempotency: 'safe',
});

export const renderDesignScript = defineFeatureOperation({
  id: 'design.script.render', path: '/v1/features/design/scripts/render', method: 'POST',
  input: defineRuntimeCodec<RenderDesignScriptInput>((input) => {
    const { ref, scriptPath, width, height, inputs } = record(input);
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0
      || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) throw new Error('Invalid script dimensions.');
    return { ref: refCodec.parse(ref), scriptPath: parseDesignScriptPath(scriptPath), width, height,
      ...(inputs === undefined ? {} : { inputs: parseDesignScriptInputs(inputs) }) };
  }),
  output: designDocumentCodec,
  errors: scriptErrors, idempotency: 'non-idempotent',
});

export const createDesignDocument = defineFeatureOperation({
  id: 'design.document.create', path: documentsRoute, method: 'POST', input: createCodec, output: entryCodec,
  errors: { [WORKSPACE_ENTRY_EXISTS_ERROR_CODE]: { status: 409 } }, idempotency: 'non-idempotent',
});

export const prepareDesignLibraryPreset = defineFeatureOperation({
  id: 'design.library.prepare-preset', path: '/v1/features/design/libraries/preset', method: 'POST',
  input: defineRuntimeCodec<PrepareDesignLibraryPresetInput>((input) => {
    const { ref, presetId } = record(input);
    const preset = designLibraryPresets.find(({ id }) => id === presetId);
    if (!preset) throw new Error('Unknown design library preset.');
    return { ref: refCodec.parse(ref), presetId: preset.id };
  }),
  output: defineRuntimeCodec((input) => {
    const edit = parseDesignEdit(input);
    if (edit.kind !== 'linkLibrary') throw new Error('Expected a design library link.');
    return edit;
  }),
  errors: { ...documentErrors, ...resourceRootErrors, [WORKSPACE_ENTRY_EXISTS_ERROR_CODE]: { status: 409 } },
  idempotency: 'idempotent',
});

export const moveDesignDocument = defineFeatureOperation({
  id: 'design.document.move', path: `${documentsRoute}/move`, method: 'POST',
  input: defineRuntimeCodec<MoveDesignDocumentInput>((input) => {
    const value = record(input);
    return { ref: refCodec.parse(value.ref), destination: workspace(record(value.destination)), command: readDesignCommandKey(value.command), ...optionalRevision(value) };
  }),
  output: refCodec,
  errors: { ...documentErrors, ...resourceRootErrors, [WORKSPACE_ENTRY_EXISTS_ERROR_CODE]: { status: 409 },
    DESIGN_LIBRARY_IN_USE: { status: 409 }, DESIGN_DEPENDENCY_UNAVAILABLE: { status: 409 }, DESIGN_LIBRARY_PROJECT_REQUIRED: { status: 409 } },
  idempotency: 'non-idempotent',
});

export const deleteDesignDocument = defineFeatureOperation({
  id: 'design.document.delete', path: documentsRoute, method: 'DELETE',
  input: defineRuntimeCodec((input) => {
    const value = record(input);
    return { ...refCodec.parse(value), ...optionalRevision(value), ...designCommandQuery(designCommandFromQuery(value)) };
  }),
  output: defineRuntimeCodec<null>((input) => {
    if (input !== null) throw new Error('Invalid design deletion result.');
    return null;
  }),
  errors: { ...documentErrors, DESIGN_LIBRARY_IN_USE: { status: 409 }, DESIGN_DEPENDENCY_UNAVAILABLE: { status: 409 } }, idempotency: 'idempotent',
});

export const readDesignDocument = defineFeatureOperation({
  id: 'design.document.read', path: documentsRoute, method: 'GET',
  input: defineRuntimeCodec<DesignDocumentRef>((input) => {
    const value = record(input);
    return { ...workspace(value), path: findBundledDesignLibrary(value.path)?.bundledPath ?? designPath(value.path) };
  }),
  output: snapshotCodec,
  errors: documentErrors, idempotency: 'safe',
});

export const resolveDesignDocumentRoot = defineFeatureOperation({
  id: 'design.document.resolve-root', path: `${documentsRoute}/resource-root`, method: 'GET', input: refCodec, output: refCodec,
  errors: { ...documentErrors, ...resourceRootErrors }, idempotency: 'safe',
});

export const commitDesignEdits = defineFeatureOperation({
  id: 'design.document.edit', path: `${documentsRoute}/edits`, method: 'POST', input: editCodec, output: snapshotCodec,
  errors: documentErrors, idempotency: 'non-idempotent',
});

export const navigateDesignHistory = defineFeatureOperation({
  id: 'design.document.history', path: `${documentsRoute}/history`, method: 'POST', input: historyCodec, output: snapshotCodec,
  errors: documentErrors, idempotency: 'non-idempotent',
});

function optionalRevision(value: Record<string, unknown>) {
  return value.expectedRevision === undefined ? {} : { expectedRevision: requiredString(value.expectedRevision) };
}

function mutation(value: Record<string, unknown>): DesignMutation {
  return { ref: refCodec.parse(value.ref), expectedRevision: requiredString(value.expectedRevision) };
}

function workspace(value: Record<string, unknown>): DesignWorkspace {
  if (value.storageId !== undefined) {
    if (value.projectId !== undefined || value.rootId !== undefined || typeof value.storageId !== 'string'
      || !/^(?:local|[a-f0-9]{64})$/u.test(value.storageId)) throw new Error('Invalid design storage directory.');
    return { storageId: value.storageId };
  }
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
