import { randomUUID } from 'node:crypto';
import { WORKSPACE_ENTRY_EXISTS_ERROR_CODE, WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES } from '@setsuna-desktop/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  designDocumentCodec, designDocumentVersion, indexDesignParents, type ChatDesignScope, type DesignEdit, type CommitDesignEditsInput, type CreateDesignDocumentInput, type DesignDocument,
  type DesignDocumentRef, type DesignSnapshot, type DesignWorkspaceDocument, type DesignWorkspaceFiles,
  type NavigateDesignHistoryInput,
} from '../contracts/index.js';
import { applyDesignEdits } from '../contracts/apply-design-edits.js';
import { designLibraryPresetIdPrefix, designLibraryPresets, findBundledDesignLibrary,
  isDesignLibraryPresetDocumentId, type DesignLibraryPresetId } from '../contracts/design-library-presets.js';

const historyDepth = 32;
const historyDocuments = 12;

type DesignHistory = {
  revision: string;
  document: DesignDocument;
  undo: readonly DesignDocument[];
  redo: readonly DesignDocument[];
};

export class DesignDocumentService {
  private readonly histories = new Map<string, DesignHistory>();

  constructor(private readonly files: Pick<DesignWorkspaceFiles, 'create' | 'withDocument'>) {}

  create(input: CreateDesignDocumentInput, signal: AbortSignal, chat?: ChatDesignScope) {
    const document: DesignDocument = { schemaVersion: designDocumentVersion, documentId: randomUUID(), rootIds: [], nodes: {} };
    return this.files.create(input, serializeDocument(document), signal, chat);
  }

  async prepareLibraryPreset(ref: DesignDocumentRef, presetId: DesignLibraryPresetId, signal: AbortSignal) {
    const preset = designLibraryPresets.find(({ id }) => id === presetId)!;
    const prefix = designLibraryPresetIdPrefix(presetId);
    const { document, projectBacked } = await this.withSnapshot(ref, signal, ({ document }, file) => ({
      document, projectBacked: file.projectBacked ?? Boolean(ref.projectId),
    }));
    if (isDesignLibraryPresetDocumentId(document.documentId, presetId)) throw new FeatureOperationFailure({
      code: 'INVALID_INPUT', message: 'A design library cannot link to itself.', retryable: false,
    });
    const existing = Object.entries(document.libraries ?? {}).find(([id]) => isDesignLibraryPresetDocumentId(id, presetId));
    const path = existing?.[1] ?? (projectBacked ? preset.fileName : preset.bundledPath);
    const link = (documentId: string) => ({ kind: 'linkLibrary' as const, documentId, path });
    if (path === preset.bundledPath) return link((await this.read({ ...ref, path }, signal)).document.documentId);

    const readLibrary = () => this.files.withDocument({ ...ref, path }, signal, async (file) => {
      const state = await this.readHistory(file);
      const source = state.document;
      if (!isDesignLibraryPresetDocumentId(source.documentId, presetId) || (existing && source.documentId !== existing[0])) throw new FeatureOperationFailure({
        code: WORKSPACE_ENTRY_EXISTS_ERROR_CODE, message: 'Another design file already uses the preset library name.', retryable: false,
      });
      const { refreshPresetLibrary } = await import('./design-library-presets.js');
      const updated = await refreshPresetLibrary(presetId, source);
      signal.throwIfAborted();
      if (updated !== source) await this.replace(file, state, serializeDocument(updated), { document: updated, undo: [], redo: [] });
      signal.throwIfAborted();
      return link(source.documentId);
    });

    try {
      return await readLibrary();
    } catch (error) {
      if (existing || !(error instanceof FeatureOperationFailure) || error.code !== 'DESIGN_NOT_FOUND') throw error;
    }

    const { createPresetLibrary } = await import('./design-library-presets.js');
    signal.throwIfAborted();
    const documentId = `${prefix}${randomUUID()}`;
    const content = serializeDocument(await createPresetLibrary(presetId, documentId));
    try {
      await this.files.create({ ...ref, parentPath: '.', name: path }, content, signal);
    } catch (error) {
      // Exclusive creation lets concurrent connections reuse the first copy and its identity.
      if (!(error instanceof FeatureOperationFailure) || error.code !== WORKSPACE_ENTRY_EXISTS_ERROR_CODE) throw error;
      return readLibrary();
    }
    return link(documentId);
  }

  async read(ref: DesignDocumentRef, signal: AbortSignal): Promise<DesignSnapshot> {
    const preset = findBundledDesignLibrary(ref.path);
    if (preset) {
      const { readBundledDesignLibrary } = await import('./design-library-presets.js');
      signal.throwIfAborted();
      const snapshot = await readBundledDesignLibrary(preset.id);
      signal.throwIfAborted();
      return snapshot;
    }
    return this.files.withDocument(ref, signal, async (file) => {
      const snapshot = toSnapshot(await this.readHistory(file));
      const project = await file.linkedProject?.(snapshot.document.documentId);
      signal.throwIfAborted();
      return { ...snapshot, workspaceRoot: file.workspaceRoot, linkedProjectId: project === undefined ? ref.projectId ?? null : project };
    });
  }

  withSnapshot<T>(ref: DesignDocumentRef, signal: AbortSignal, use: (snapshot: DesignSnapshot, file: DesignWorkspaceDocument) => T | Promise<T>): Promise<T> {
    return this.files.withDocument(ref, signal, async (file) => {
      const snapshot = toSnapshot(await this.readHistory(file));
      signal.throwIfAborted();
      return use(snapshot, file);
    });
  }

  commit(input: CommitDesignEditsInput, signal: AbortSignal, check?: (document: DesignDocument, file: DesignWorkspaceDocument) => void | Promise<void>, dryRun = false): Promise<DesignSnapshot> {
    return this.files.withDocument(input.ref, signal, async (file) => {
      const state = await this.readHistory(file);
      assertEditableDocument(state.document);
      await check?.(state.document, file);
      assertRevision(state, input.expectedRevision);
      signal.throwIfAborted();
      const edited = applyDesignEdits(state.document, input.edits);
      const content = serializeDocument(edited);
      if (content === serializeDocument(state.document)) return toSnapshot(state);
      const lastEditedLayerId = lastSavedLayer(state.document, edited, input.edits);
      const document = lastEditedLayerId === edited.lastEditedLayerId ? edited : { ...edited, lastEditedLayerId };
      const savedContent = document === edited ? content : serializeDocument(document);
      if (dryRun) return toSnapshot(state);
      return this.replace(file, state, savedContent, {
        document, undo: [...state.undo, state.document].slice(-historyDepth), redo: [],
      });
    });
  }

  navigate(input: NavigateDesignHistoryInput, signal: AbortSignal): Promise<DesignSnapshot> {
    return this.files.withDocument(input.ref, signal, async (file) => {
      const state = await this.readHistory(file);
      assertEditableDocument(state.document);
      assertRevision(state, input.expectedRevision);
      const from = state[input.direction];
      const document = from.at(-1);
      if (!document) return toSnapshot(state);
      const next = input.direction === 'undo'
        ? { undo: from.slice(0, -1), redo: [...state.redo, state.document] }
        : { undo: [...state.undo, state.document], redo: from.slice(0, -1) };
      return this.replace(file, state, serializeDocument(document), { document, ...next });
    });
  }

  private async readHistory(file: DesignWorkspaceDocument): Promise<DesignHistory> {
    const { content, revision } = await file.read();
    const state = this.histories.get(file.key);
    if (state?.revision === revision) return state;
    // File changes from outside this service invalidate the in-memory undo chain.
    this.histories.delete(file.key);
    try {
      return { revision, document: designDocumentCodec.parse(JSON.parse(content)), undo: [], redo: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid design document.';
      throw new FeatureOperationFailure({ code: 'INVALID_DESIGN_DOCUMENT', message, retryable: false });
    }
  }

  private async replace(
    file: DesignWorkspaceDocument, previous: DesignHistory, content: string, next: Omit<DesignHistory, 'revision'>,
  ): Promise<DesignSnapshot> {
    const revision = await file.replace(content, previous.revision, previous.document, next.document);
    const state = { revision, ...next };
    this.histories.delete(file.key);
    this.histories.set(file.key, state);
    if (this.histories.size > historyDocuments) {
      const oldest = this.histories.keys().next().value;
      if (oldest !== undefined) this.histories.delete(oldest);
    }
    return toSnapshot(state);
  }
}

function lastSavedLayer(before: DesignDocument, after: DesignDocument, edits: readonly DesignEdit[]) {
  let parents: ReadonlyMap<string, string | null> | undefined;
  for (let index = edits.length - 1; index >= 0; index--) {
    const edit = edits[index];
    if (!('nodeId' in edit)) continue;
    let id: string | null = edit.nodeId;
    // A deleted block can still lead back to the surviving card or board.
    while (id && !Object.hasOwn(after.nodes, id)) {
      parents ??= indexDesignParents(before);
      id = parents.get(id) ?? null;
    }
    if (id) return id;
  }
  const previous = before.lastEditedLayerId;
  return previous && Object.hasOwn(after.nodes, previous) ? previous : undefined;
}

function assertRevision(state: DesignHistory, expected: string): void {
  if (state.revision === expected) return;
  throw new FeatureOperationFailure({ code: 'REVISION_CONFLICT', message: 'The design changed on disk.', retryable: true });
}

function assertEditableDocument(document: DesignDocument) {
  if (isDesignLibraryPresetDocumentId(document.documentId)) throw new FeatureOperationFailure({
    code: 'INVALID_INPUT', message: 'Built-in design library sources are read-only.', retryable: false,
  });
}

function toSnapshot(state: DesignHistory): DesignSnapshot {
  return { document: state.document, revision: state.revision, canUndo: state.undo.length > 0, canRedo: state.redo.length > 0 };
}

function serializeDocument(document: DesignDocument): string {
  const content = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(content) <= WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES) return content;
  throw new FeatureOperationFailure({ code: 'INVALID_INPUT', message: 'The design exceeds the workspace file size limit.', retryable: false });
}
