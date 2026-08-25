import {
  ConversationGitControls,
  WorkspaceGitCommitProvider,
} from '@setsuna-desktop/feature-review/renderer/git';
import {
  ReviewRendererHostProvider,
  type ReviewRendererHost,
} from '@setsuna-desktop/feature-review/renderer/host';
import {
  latestCompletedReview,
  localReviewChangeStats,
} from '@setsuna-desktop/feature-review/renderer/model';
import { useDesktopReviewState } from '@setsuna-desktop/feature-review/renderer/state';
import { useMemo, type ComponentProps, type PropsWithChildren } from 'react';
import { useToast } from '../app/providers/ToastProvider.js';
import { MarkdownNavigationProvider } from '../features/chat/markdown/MarkdownNavigationProvider.js';
import { MarkdownRenderer } from '../features/chat/markdown/MarkdownRenderer.js';
import { WorkspaceFileContextMenu } from '../features/workspace/WorkspaceFileContextMenu.js';
import { WorkspaceFileIcon } from '../features/workspace/WorkspaceFileIcon.js';
import { CodePatchView } from '../shared/code/PierreCode.js';
import { codeDiffLinesToPatch } from '../shared/code/diffPatch.js';
import { useI18n } from '../shared/i18n/I18nProvider.js';
import { Checkbox } from '../shared/ui/primitives.js';

const reviewUi: ReviewRendererHost['ui'] = Object.freeze({
  Checkbox,
  CodePatchView,
  FileContextMenu: ReviewFileContextMenu,
  FileIcon: ReviewFileIcon,
  FindingMarkdown: ReviewFindingMarkdown,
});

/** Connects the portable Review renderer to app-owned UI and preload services. */
export function ReviewFeatureHostBoundary({ children }: PropsWithChildren) {
  const { t } = useI18n();
  const toast = useToast();
  const host = useMemo<ReviewRendererHost>(() => ({
    bridge: window.setsunaDesktop?.desktopReview ?? null,
    buildPatch: codeDiffLinesToPatch,
    notifySuccess: (message) => {
      toast.success(message);
    },
    platform: window.setsunaDesktop?.desktop.platform,
    translate: t,
    ui: reviewUi,
  }), [t, toast]);

  return <ReviewRendererHostProvider host={host}>{children}</ReviewRendererHostProvider>;
}

function ReviewFileContextMenu({
  onAddToConversation,
  target,
  ...props
}: ComponentProps<ReviewRendererHost['ui']['FileContextMenu']>) {
  return (
    <WorkspaceFileContextMenu
      {...props}
      target={target ? { ...target, type: 'file' } : null}
      onAddToConversation={(filePath) => onAddToConversation(filePath)}
    />
  );
}

function ReviewFileIcon(props: ComponentProps<ReviewRendererHost['ui']['FileIcon']>) {
  return <WorkspaceFileIcon {...props} type="file" />;
}

function ReviewFindingMarkdown({
  content,
  onOpenWorkspaceFile,
  workspaceRoot,
}: ComponentProps<ReviewRendererHost['ui']['FindingMarkdown']>) {
  return (
    <MarkdownNavigationProvider
      workspaceRoot={workspaceRoot}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    >
      <MarkdownRenderer content={content} streaming={false} />
    </MarkdownNavigationProvider>
  );
}

export {
  ConversationGitControls as ReviewFeatureConversationGitControls,
  WorkspaceGitCommitProvider as ReviewFeatureGitCommitProvider,
  latestCompletedReview as latestCompletedFeatureReview,
  localReviewChangeStats as localFeatureReviewChangeStats,
  useDesktopReviewState as useReviewFeatureState,
};
