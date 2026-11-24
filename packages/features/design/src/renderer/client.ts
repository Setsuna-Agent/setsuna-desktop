import { designCommandQuery, type DesignCommandKey } from '../contracts/design-command-key.js';
import { createDesignConversation, listDesignConversations, type DesignConversationOwner, type DesignConversation } from '../contracts/design-conversations.js';
import { startDesignTask, replyDesignTask, bindDesignInput, watchDesignCommand, stopDesignTask, type DesignTaskClient } from '../contracts/design-task.js';
import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import type { SetsunaDesktopBridge, WorkspaceEntry, WorkspaceFilePreview } from '@setsuna-desktop/contracts';
import { importDesignFont, listDesignFonts, readDesignFont, removeDesignFont, type DesignCustomFont } from '../contracts/design-fonts.js';
import { prepareDesignLibraryPreset, type PrepareDesignLibraryPresetInput } from '../contracts/operations.js';
import {
  type ProjectDesignEntry, listProjectDesigns, getDesignCatalog, setDesignProject, readDesignImage, searchDesignImages, type DesignCatalog, commitDesignEdits, createDesignDocument, deleteDesignDocument, importDesignImage, importDesignScript, listDesignDocumentEntries, listDesignDocuments, moveDesignDocument, navigateDesignHistory,
  importDesignShader, readDesignDocument, readDesignScriptParameters, readDesignShader, renderDesignScript, resolveDesignDocumentRoot,
  type CommitDesignEditsInput, type CreateDesignDocumentInput, type DesignDocumentListEntry, type DesignDocumentRef, type DesignSnapshot, type DesignWorkspace,
  type DesignDocument, type DesignEdit, type DesignScriptParameter, type ImportDesignImageInput, type ImportDesignScriptInput,
  type ImportDesignShaderInput, type MoveDesignDocumentInput, type NavigateDesignHistoryInput,
  type ReadDesignScriptParametersInput, type ReadDesignShaderInput, type RenderDesignScriptInput,
} from '../contracts/index.js';

type DesignWebPreviewDevice = Readonly<{ id: string; label: string; width: number; height: number }>;

export type DesignWebPreviewHost = Readonly<{
  partition: string;
  devices: readonly DesignWebPreviewDevice[];
  configure(id: number, settings: Readonly<{
    url: string; networkAccess: boolean; device?: Readonly<{ id: string; width: number; height: number }>; interactive: boolean;
  }>): Promise<boolean>;
  capture(id: number): Promise<string | null>;
  onEscape(callback: (id: number) => void): () => void;
}>;

export type DesignAssets = Readonly<{
  chooseDirectory?: SetsunaDesktopBridge['desktop']['chooseDesignDirectory'];
  webPreview?: DesignWebPreviewHost;
  search(ref: DesignDocumentRef, query: string): Promise<readonly string[]>;
  read(ref: DesignDocumentRef, path: string): Promise<Extract<WorkspaceFilePreview, { kind: 'image' }> | null>;
  readLinkedImage(url: string, signal: AbortSignal): Promise<File>;
  requestClipboardPaste: SetsunaDesktopBridge['desktop']['pasteDesign'];
  output: Pick<SetsunaDesktopBridge['desktop'], 'saveDesignHtml' | 'saveDesignSvg' | 'saveImageAs' | 'copyImageToClipboard' | 'copyDesignLayers' | 'readDesignLayers'> & Readonly<{
    copyText(text: string): Promise<void>;
  }>;
}>;

export type DesignClient = Readonly<{
  projectDesigns(projectId: string, signal?: AbortSignal): Promise<ProjectDesignEntry[]>;
  catalog(signal?: AbortSignal): Promise<DesignCatalog>;
  setProject(owner: DesignConversationOwner, projectId: string | null): Promise<null>;
  conversations?: {
    list(owner: DesignConversationOwner, signal?: AbortSignal): Promise<DesignConversation[]>;
    create(owner: DesignConversationOwner): Promise<DesignConversation>;
  };
  tasks?: DesignTaskClient;
  assets: DesignAssets;
  fonts: DesignFontClient;
  list(workspace: DesignWorkspace, signal?: AbortSignal): Promise<readonly string[]>;
  listEntries(workspace: DesignWorkspace, signal?: AbortSignal): Promise<readonly DesignDocumentListEntry[]>;
  create(input: CreateDesignDocumentInput, signal?: AbortSignal): Promise<WorkspaceEntry>;
  prepareLibraryPreset(input: PrepareDesignLibraryPresetInput, signal?: AbortSignal): Promise<Extract<DesignEdit, { kind: 'linkLibrary' }>>;
  move(input: MoveDesignDocumentInput, signal?: AbortSignal): Promise<DesignDocumentRef>;
  delete(ref: DesignDocumentRef & { expectedRevision?: string; command?: DesignCommandKey }, signal?: AbortSignal): Promise<null>;
  resolveResourceRoot(ref: DesignDocumentRef, signal?: AbortSignal): Promise<DesignDocumentRef>;
  importImage(input: ImportDesignImageInput, signal?: AbortSignal): Promise<string>;
  importScript(input: ImportDesignScriptInput, signal?: AbortSignal): Promise<string>;
  importShader(input: ImportDesignShaderInput, signal?: AbortSignal): Promise<string>;
  readShader(input: ReadDesignShaderInput, signal?: AbortSignal): Promise<string>;
  readScriptParameters(input: ReadDesignScriptParametersInput, signal?: AbortSignal): Promise<readonly DesignScriptParameter[]>;
  renderScript(input: RenderDesignScriptInput, signal?: AbortSignal): Promise<DesignDocument>;
  read(ref: DesignDocumentRef, signal?: AbortSignal): Promise<DesignSnapshot>;
  commit(input: CommitDesignEditsInput): Promise<DesignSnapshot>;
  navigate(input: NavigateDesignHistoryInput): Promise<DesignSnapshot>;
}>;

export type DesignFontClient = Readonly<{
  list(signal?: AbortSignal): Promise<readonly DesignCustomFont[]>;
  import(base64: string, signal?: AbortSignal): Promise<DesignCustomFont>;
  read(id: string, signal?: AbortSignal): Promise<{ base64: string }>;
  remove(id: string, signal?: AbortSignal, command?: DesignCommandKey): Promise<null>;
}>;

export const designClientCapability = defineCapability<DesignClient>({
  id: 'design.renderer-client',
  description: 'Read and edit project design documents from the workspace canvas.',
});

export const designAssetsCapability = defineCapability<DesignAssets>({
  id: 'design.renderer-assets',
  description: 'Read design images and send exports to the desktop.',
});

export function createDesignClient(transport: FeatureOperationTransport, assets: DesignAssets): DesignClient {
  return {
    assets: { ...assets,
      read: (ref, path) => ref.storageId ? transport.call(readDesignImage, { ref, path }) : assets.read(ref, path),
      search: (ref, query) => ref.storageId ? transport.call(searchDesignImages, { ref, query }) : assets.search(ref, query),
    },
    projectDesigns: (projectId, signal) => transport.call(listProjectDesigns, { projectId }, { signal }),
    catalog: (signal) => transport.call(getDesignCatalog, undefined, { signal }),
    setProject: (owner, projectId) => transport.call(setDesignProject, { ...owner, projectId }),
    conversations: {
      list: (owner, signal) => transport.call(listDesignConversations, owner, { signal }),
      create: (owner) => transport.call(createDesignConversation, owner),
    },
    tasks: {
      watchCommand: (input, signal) => transport.call(watchDesignCommand, input, { signal }),
      bindInput: (input, signal) => transport.call(bindDesignInput, input, { signal }),
      start: (input, signal) => transport.call(startDesignTask, input, { signal }),
      reply: (input, signal) => transport.call(replyDesignTask, input, { signal }),
      stop: (sessionId) => transport.call(stopDesignTask, { sessionId }),
    },
    fonts: {
      list: (signal) => transport.call(listDesignFonts, undefined, { signal }),
      import: (base64, signal) => transport.call(importDesignFont, { base64 }, { signal }),
      read: (id, signal) => transport.call(readDesignFont, { id }, { signal }),
      remove: (id, signal, command) => transport.call(removeDesignFont, { id, ...designCommandQuery(command) }, { signal }),
    },
    list: (workspace, signal) => transport.call(listDesignDocuments, workspace, { signal }),
    listEntries: (workspace, signal) => transport.call(listDesignDocumentEntries, { ...workspace, includePreviewMetadata: true }, { signal }),
    create: (input, signal) => transport.call(createDesignDocument, input, { signal }),
    prepareLibraryPreset: (input, signal) => transport.call(prepareDesignLibraryPreset, input, { signal }),
    move: (input, signal) => transport.call(moveDesignDocument, input, { signal }),
    delete: ({ command, ...ref }, signal) => transport.call(deleteDesignDocument, { ...ref, ...designCommandQuery(command) }, { signal }),
    resolveResourceRoot: (ref, signal) => transport.call(resolveDesignDocumentRoot, ref, { signal }),
    importImage: (input, signal) => transport.call(importDesignImage, input, { signal }),
    importScript: (input, signal) => transport.call(importDesignScript, input, { signal }),
    importShader: (input, signal) => transport.call(importDesignShader, input, { signal }),
    readShader: (input, signal) => transport.call(readDesignShader, input, { signal }),
    readScriptParameters: (input, signal) => transport.call(readDesignScriptParameters, input, { signal }),
    renderScript: (input, signal) => transport.call(renderDesignScript, input, { signal }),
    read: (ref, signal) => transport.call(readDesignDocument, ref, { signal }),
    commit: (input) => transport.call(commitDesignEdits, input),
    navigate: (input) => transport.call(navigateDesignHistory, input),
  };
}
