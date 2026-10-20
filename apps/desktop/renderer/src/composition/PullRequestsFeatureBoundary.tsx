import type { ReactNode } from 'react';
import type { PullRequestsRendererHost } from '@setsuna-desktop/feature-pull-requests/renderer';
import { ConversationPullRequests, ThreadPullRequestBadge, ThreadPullRequestsProvider, ThreadPullRequestNavigationProvider } from '@setsuna-desktop/feature-pull-requests/renderer';
import { useI18n } from '../shared/i18n/I18nProvider.js';
import { copyTextToClipboard } from '../shared/lib/clipboard.js';
import { CodePatchView } from '../shared/code/PierreCode.js';
import { PageHeader } from '../shared/ui/primitives.js';
import { ScrollOverlay } from '../shared/ui/ScrollOverlay.js';
import { DocumentMarkdown } from '@setsuna-desktop/renderer-ui';
import { PullRequestCommentInput } from './PullRequestCommentInput.js';
import { useToast } from '../app/providers/ToastProvider.js';

export { ThreadPullRequestsProvider as PullRequestsFeatureServiceBoundary, ThreadPullRequestNavigationProvider as PullRequestsFeatureNavigationBoundary };

const openExternal = (url: string) => window.setsunaDesktop?.links.openExternal(url) ?? Promise.resolve(false);
function Markdown({ content, baseUrl }: { content: string; baseUrl: string }) {
  return <DocumentMarkdown content={content} baseUrl={baseUrl} onOpenLink={(url) => { void openExternal(url); }} />;
}
export function PullRequestsFeatureBoundary({ children }: { children(host: PullRequestsRendererHost): ReactNode }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  return children({
    Markdown, PageHeader, CodePatch: CodePatchView, CommentInput: PullRequestCommentInput, ScrollOverlay,
    openExternal, copyText: copyTextToClipboard,
    notifyError: (message) => { toast.error(message); },
    translate: t, locale,
  });
}

export function PullRequestsFeatureConversation({ threadId }: { threadId: string }) {
  const { t } = useI18n();
  return <ConversationPullRequests threadId={threadId} translate={t} />;
}
export function PullRequestsFeatureThreadBadge({ threadId }: { threadId: string }) {
  const { t } = useI18n();
  return <ThreadPullRequestBadge threadId={threadId} translate={t} className="desktop-agent-session__pr" />;
}
