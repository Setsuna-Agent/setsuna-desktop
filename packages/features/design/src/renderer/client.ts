import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import type { SetsunaDesktopBridge, WorkspaceEntry, WorkspaceFilePreview } from '@setsuna-desktop/contracts';
import { importDesignFont, listDesignFonts, readDesignFont, removeDesignFont, type DesignCustomFont } from '../contracts/design-fonts.js';
import {
  commitDesignEdits, createDesignDocument, deleteDesignDocument, importDesignImage, importDesignScript, listDesignDocuments, moveDesignDocument, navigateDesignHistory,
  importDesignShader, readDesignDocument, readDesignScriptParameters, readDesignShader, renderDesignScript, resolveDesignDocumentRoot,
  type CommitDesignEditsInput, type CreateDesignDocumentInput, type DesignDocumentRef, type DesignSnapshot, type DesignWorkspace,
  type DesignDocument, type DesignScriptParameter, type ImportDesignImageInput, type ImportDesignScriptInput,
  type ImportDesignShaderInput, type MoveDesignDocumentInput, type NavigateDesignHistoryInput,
  type ReadDesignScriptParametersInput, type ReadDesignShaderInput, type RenderDesignScriptInput,
} from '../contracts/index.js';

type DesignWebPreviewDevice = Readonly<{ id: string; label: string; width: number; height: number }>;

export type DesignWebPreviewHost = Readonly<{
  partition: string;
  devices: readonly DesignWebPreviewDevice[];
  configure(id: number, settings: Readonly<{
    url: string; device?: Readonly<{ id: string; width: number; height: number }>; interactive: boolean;
  }>): Promise<boolean>;
  capture(id: number): Promise<string | null>;
  onEscape(callback: (id: number) => void): () => void;
}>;

export type DesignAssets = Readonly<{
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
  assets: DesignAssets;
  fonts: DesignFontClient;
  list(workspace: DesignWorkspace, signal?: AbortSignal): Promise<readonly string[]>;
  create(input: CreateDesignDocumentInput): Promise<WorkspaceEntry>;
  move(input: MoveDesignDocumentInput): Promise<DesignDocumentRef>;
  delete(ref: DesignDocumentRef): Promise<null>;
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
  import(base64: string): Promise<DesignCustomFont>;
  read(id: string, signal?: AbortSignal): Promise<{ base64: string }>;
  remove(id: string): Promise<null>;
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
    assets,
    fonts: {
      list: (signal) => transport.call(listDesignFonts, undefined, { signal }),
      import: (base64) => transport.call(importDesignFont, { base64 }),
      read: (id, signal) => transport.call(readDesignFont, { id }, { signal }),
      remove: (id) => transport.call(removeDesignFont, { id }),
    },
    list: (workspace, signal) => transport.call(listDesignDocuments, workspace, { signal }),
    create: (input) => transport.call(createDesignDocument, input),
    move: (input) => transport.call(moveDesignDocument, input),
    delete: (ref) => transport.call(deleteDesignDocument, ref),
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
