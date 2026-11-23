import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { canAccessChatDesign, chatDesignTool, createDesignDocument, designDocumentFileName, designMentionText, parseDesignMentions,
  type ChatDesignTools, type ChatDesignScope, type DesignConversationOwner, type DesignWorkspaceDocument,
  type DesignWorkspaceFiles } from '../contracts/index.js';
import { parseDesignSelectionMentions } from '../contracts/design-selection-mention.js';
import { designTaskRecord, readDesignSelection } from '../contracts/design-task.js';
import type { DesignDocumentService } from './design-document-service.js';
import { ChatDesignAssets } from './chat-design-assets.js';
import type { DesignTasks } from './design-tasks.js';

export function createChatDesignTools(files: Pick<DesignWorkspaceFiles, 'projectDesigns' | 'resolveResourceRoot' | 'list'>, documents: DesignDocumentService,
  tasks: Pick<DesignTasks, 'openChatCanvas' | 'chatCanvasRole' | 'leave'>): ChatDesignTools {
  function definition(writable: boolean, canvasOpen: boolean): RuntimeToolDefinition {
    const actions = ['list', 'open'];
    if (writable) actions.push('create');
    if (canvasOpen) actions.push('finish');
    return { name: chatDesignTool, description: 'Find designs linked to this project, including externally stored drafts. ' +
      (writable ? 'Create a blank local design or open an existing design in the live editor. ' : 'Open a linked design in the live editor. ') +
      'Pass the complete design mention from the user or list result. After opening, use the native design tools on the canvas.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['action'], properties: {
        action: { type: 'string', enum: actions },
        reference: { type: 'string', description: 'Complete draft or design-selection://canvas mention. Pass a picked board or layer mention unchanged to start with that selection.' }, name: { type: 'string' },
      } },
    };
  }
  async function create(name: unknown, scope: ChatDesignScope, signal: AbortSignal): Promise<DesignConversationOwner> {
    if (typeof name !== 'string' || !name.trim()) throw new Error('A draft name is required.');
    const input = createDesignDocument.input.parse({ storageId: 'local', parentPath: '.', name: designDocumentFileName(name.trim()) });
    const created = await documents.create(input, signal, scope);
    const ref = { storageId: 'local', path: created.path };
    return { ref, documentId: (await documents.read(ref, signal)).document.documentId };
  }
  return { definition, async execute(input, scope, { writable, networkAccess }, signal) {
    const { action, name, reference } = designTaskRecord(input);
    if (action === 'finish' && tasks.chatCanvasRole(scope.threadId, scope.turnId) === 'owner') {
      await tasks.leave(scope.threadId, scope.turnId);
      return { content: 'Canvas editing finished. The draft remains open.', containsExternalContext: true };
    }
    if (action === 'list') {
      const owners = scope.projectId ? await files.projectDesigns(scope.projectId, signal) : [];
      return { content: JSON.stringify(owners.map((owner) => ({ reference: designMentionText(owner), directory: owner.directory }))), containsExternalContext: true };
    }
    if (action !== 'open' && !(writable && action === 'create')) throw new Error('Open the canvas, then use design_edit.');
    const { owner, selection } = action === 'create' ? { owner: await create(name, scope, signal), selection: [] } : referencedDesign(reference);
    const allowed = async (ref: DesignConversationOwner['ref'], id: string, file: DesignWorkspaceDocument) => {
      const association = await file.linkedProject?.(id);
      return canAccessChatDesign(scope, association === undefined ? ref.projectId : association, async () => file.chatOrigin?.(id));
    };
    const authorize = async (id: string, file: DesignWorkspaceDocument) => {
      if (id === owner.documentId && await allowed(owner.ref, id, file)) return;
      throw new Error('This design is unavailable in this conversation.');
    };
    const inspect = (signal: AbortSignal, ids: readonly string[] = []) => documents.withSnapshot(owner.ref, signal, async (snapshot, file) => {
      await authorize(snapshot.document.documentId, file);
      if (ids.some((id) => !Object.hasOwn(snapshot.document.nodes, id))) throw new Error('A referenced design layer is no longer available.');
      return snapshot;
    });
    const { revision } = await inspect(signal, selection);
    const ref = await files.resolveResourceRoot(owner.ref, signal);
    const canvasRequestId = await tasks.openChatCanvas(scope.threadId, { ref, documentId: owner.documentId, selection }, {
      assets: ref.projectId && ref.projectId === scope.projectId ? undefined : new ChatDesignAssets(ref, documents),
      listDocuments: (signal) => files.list(ref, signal, scope),
      async libraryId(path, signal) {
        const library = { ...ref, path };
        const id = await documents.withSnapshot(library, signal, async ({ document }, file) =>
          await allowed(library, document.documentId, file) ? document.documentId : undefined).catch(() => undefined);
        signal.throwIfAborted();
        if (!id) throw new Error('This design library is unavailable in this conversation.');
        return id;
      },
      turnId: scope.turnId, authorize, verify: inspect,
    }, signal);
    return { content: JSON.stringify({ reference: designMentionText(owner), revision, next: 'Use design_inspect, design_view and design_edit in the live canvas.' }),
      data: { resultKind: 'design.draft', resultMajor: 1, payload: { ...owner, action, revision, networkAccess, canvasRequestId } }, containsExternalContext: true };
  } };
}

function referencedDesign(input: unknown): { owner: DesignConversationOwner; selection: string[] } {
  const reference = typeof input === 'string' ? input.trim() : '';
  const [mention] = parseDesignMentions(reference);
  if (mention?.start === 0 && mention.end === reference.length) return { owner: mention.owner, selection: [] };
  const [pick] = parseDesignSelectionMentions(reference);
  if (pick?.start === 0 && pick.end === reference.length && pick.reference.ref) {
    const { ref, documentId, ids } = pick.reference;
    return { owner: { ref, documentId }, selection: readDesignSelection(ids) };
  }
  throw new Error('Use a design reference from the current project or chat.');
}
