import type { FileDiff, PostRenderPhase } from '@pierre/diffs';
import type { DiffLineAnnotation } from '@pierre/diffs/react';
import type { CheckboxProps } from '@setsuna-desktop/renderer-contracts/settings';
import type { DesktopWorkspaceApp } from '@setsuna-desktop/feature-workspace-apps/contracts';
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type {
  DesktopDiffFile,
  DesktopReviewBridge,
} from '../contracts/index.js';
import type { ReviewTranslate } from './messages.js';

export type ReviewFileContextTarget = {
  filePath: string;
  line?: number;
  x: number;
  y: number;
};

export type ReviewCodePatchViewProps = {
  className?: string;
  layout?: 'split' | 'unified';
  lineAnnotations?: DiffLineAnnotation<ReactNode>[];
  onPostRender?: (
    node: HTMLElement,
    instance: FileDiff<ReactNode>,
    phase: PostRenderPhase,
  ) => unknown;
  patch: string;
  wrap?: boolean;
};

export type ReviewFileContextMenuProps = {
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  target: ReviewFileContextTarget | null;
  workspaceApps: DesktopWorkspaceApp[];
  onAddToConversation: (filePath: string) => void;
  onClose: () => void;
  onCopyPath: (filePath: string) => void;
  onOpenWithApp: (appId: string, filePath: string, line?: number) => void;
  onReveal: (filePath: string) => void;
};

export type ReviewFindingMarkdownProps = {
  content: string;
  workspaceRoot?: string;
  onOpenWorkspaceFile: (filePath: string, line?: number) => void;
};

export type ReviewRendererHost = Readonly<{
  bridge: DesktopReviewBridge | null;
  buildPatch(file: DesktopDiffFile): string;
  notifySuccess(message: string): void;
  platform?: string;
  translate: ReviewTranslate;
  ui: Readonly<{
    Checkbox: ComponentType<CheckboxProps>;
    CodePatchView: ComponentType<ReviewCodePatchViewProps>;
    FileContextMenu: ComponentType<ReviewFileContextMenuProps>;
    FileIcon: ComponentType<{ className?: string; path: string }>;
    FindingMarkdown: ComponentType<ReviewFindingMarkdownProps>;
  }>;
}>;

const ReviewRendererHostContext = createContext<ReviewRendererHost | null>(null);

export function ReviewRendererHostProvider({
  children,
  host,
}: Readonly<{ children: ReactNode; host: ReviewRendererHost }>) {
  return (
    <ReviewRendererHostContext.Provider value={host}>
      {children}
    </ReviewRendererHostContext.Provider>
  );
}

export function useReviewRendererHost(): ReviewRendererHost {
  const host = useContext(ReviewRendererHostContext);
  if (!host) throw new Error('Review renderer host is unavailable.');
  return host;
}
