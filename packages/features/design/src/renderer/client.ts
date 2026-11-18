import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import type { SetsunaDesktopBridge, WorkspaceEntry, WorkspaceFilePreview } from '@setsuna-desktop/contracts';
import {
  commitDesignEdits, createDesignDocument, importDesignImage, listDesignDocuments, navigateDesignHistory, readDesignDocument, type CommitDesignEditsInput,
  type CreateDesignDocumentInput, type DesignDocumentRef, type DesignSnapshot, type DesignWorkspace, type ImportDesignImageInput, type NavigateDesignHistoryInput,
} from '../contracts/index.js';

export type DesignAssets = Readonly<{
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
  list(workspace: DesignWorkspace, signal?: AbortSignal): Promise<readonly string[]>;
  create(input: CreateDesignDocumentInput): Promise<WorkspaceEntry>;
  importImage(input: ImportDesignImageInput, signal?: AbortSignal): Promise<string>;
  read(ref: DesignDocumentRef, signal?: AbortSignal): Promise<DesignSnapshot>;
  commit(input: CommitDesignEditsInput): Promise<DesignSnapshot>;
  navigate(input: NavigateDesignHistoryInput): Promise<DesignSnapshot>;
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
    list: (workspace, signal) => transport.call(listDesignDocuments, workspace, { signal }),
    create: (input) => transport.call(createDesignDocument, input),
    importImage: (input, signal) => transport.call(importDesignImage, input, { signal }),
    read: (ref, signal) => transport.call(readDesignDocument, ref, { signal }),
    commit: (input) => transport.call(commitDesignEdits, input),
    navigate: (input) => transport.call(navigateDesignHistory, input),
  };
}
