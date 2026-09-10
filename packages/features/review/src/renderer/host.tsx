import type { FileDiff, PostRenderPhase } from '@pierre/diffs';
import type { DiffLineAnnotation } from '@pierre/diffs/react';
import type { CheckboxProps, SettingsDialogProps, SettingsSelectFieldProps, SettingsToggleProps } from '@setsuna-desktop/renderer-contracts/settings';
import type { DropdownProps } from '@setsuna-desktop/renderer-ui';
import type { DesktopWorkspaceApp } from '@setsuna-desktop/feature-workspace-apps/contracts';
import { createContext, useContext, type ComponentType, type ReactNode, type RefObject } from 'react';
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

export type ReviewCommitMessageInputProps = {
  content: string;
  onChange(content: string): void;
  onSave(): void;
};

export type ReviewConflictTaskProgressProps = {
  threadId: string;
  turnId: string;
  workspaceRoot: string;
  onBack(): void;
  onFinished(): void;
  onOpenWorkspaceFile?(filePath: string, line?: number): void;
};

export type ReviewRendererHost = Readonly<{
  bridge: DesktopReviewBridge | null;
  buildPatch(file: DesktopDiffFile): string;
  copyText(value: string): Promise<void>;
  openExternal(url: string): Promise<boolean>;
  locale: string;
  notifySuccess(message: string): void;
  notifyError(message: string): void;
  platform?: string;
  translate: ReviewTranslate;
  ui: Readonly<{
    Dialog: ComponentType<SettingsDialogProps>;
    SelectField: ComponentType<SettingsSelectFieldProps>;
    Toggle: ComponentType<SettingsToggleProps>;
    Checkbox: ComponentType<CheckboxProps>;
    ContextMenu: ComponentType<Pick<DropdownProps, 'align' | 'children' | 'disabled' | 'menu' | 'onOpenChange' | 'placement' | 'trigger'>>;
    CodePatchView: ComponentType<ReviewCodePatchViewProps>;
    CommitMessageInput: ComponentType<ReviewCommitMessageInputProps>;
    ConflictTaskProgress: ComponentType<ReviewConflictTaskProgressProps>;
    ScrollOverlay: ComponentType<{ scrollRef: RefObject<HTMLDivElement | null> }>;
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
