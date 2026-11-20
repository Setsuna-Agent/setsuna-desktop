import { randomUUID } from 'node:crypto';
import { WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES } from '@setsuna-desktop/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  designDocumentCodec, designDocumentVersion, indexDesignParents, type DesignEdit, type CommitDesignEditsInput, type CreateDesignDocumentInput, type DesignDocument,
  type DesignDocumentRef, type DesignSnapshot, type DesignWorkspaceDocument, type DesignWorkspaceFiles,
  type NavigateDesignHistoryInput,
} from '../contracts/index.js';
import { applyDesignEdits } from '../contracts/apply-design-edits.js';

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

  create(input: CreateDesignDocumentInput, signal: AbortSignal) {
    const document: DesignDocument = { schemaVersion: designDocumentVersion, documentId: randomUUID(), rootIds: [], nodes: {} };
    return this.files.create(input, serializeDocument(document), signal);
  }

  read(ref: DesignDocumentRef, signal: AbortSignal): Promise<DesignSnapshot> {
    return this.withSnapshot(ref, signal, (snapshot) => snapshot);
  }

  withSnapshot<T>(ref: DesignDocumentRef, signal: AbortSignal, use: (snapshot: DesignSnapshot) => T | Promise<T>): Promise<T> {
    return this.files.withDocument(ref, signal, async (file) => {
      const snapshot = toSnapshot(await this.readHistory(file));
      signal.throwIfAborted();
      return use(snapshot);
    });
  }

  commit(input: CommitDesignEditsInput, signal: AbortSignal, check?: (document: DesignDocument) => void, dryRun = false): Promise<DesignSnapshot> {
    return this.files.withDocument(input.ref, signal, async (file) => {
      const state = await this.readHistory(file);
      assertRevision(state, input.expectedRevision);
      signal.throwIfAborted();
      check?.(state.document);
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

function toSnapshot(state: DesignHistory): DesignSnapshot {
  return { document: state.document, revision: state.revision, canUndo: state.undo.length > 0, canRedo: state.redo.length > 0 };
}

function serializeDocument(document: DesignDocument): string {
  const content = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(content) <= WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES) return content;
  throw new FeatureOperationFailure({ code: 'INVALID_INPUT', message: 'The design exceeds the workspace file size limit.', retryable: false });
}
