import { lazy, Suspense } from 'react';
import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRendererDependencies, defineRendererFeature, rendererFeatureOperationTransportCapability } from '@setsuna-desktop/feature-core/renderer';
import { shellRouteSlot, shellSidebarAvatarSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { pullRequestsFeature, pullRequestFromPanelId, threadPullRequestsStateCapability } from '../contracts/index.js';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import { ThreadPullRequestsState } from './threads/state.js';
import { pullRequestsRendererHostCapability } from './host.js';
import { createPullRequestsClient } from './client.js';
import { createPullRequestSession } from './session.js';
import { PullRequestConnectionState } from './account/connection-state.js';
import { GitHubAccountAvatar } from './account/GitHubAccountAvatar.js';
import { pullRequestsMessages } from './messages.js';
import { PullRequestSkeleton } from './loading/PullRequestSkeleton.js';
import './pull-requests.css';

const Page = lazy(() => import('./PullRequestsPage.js').then((module) => ({ default: module.PullRequestsPage })));
const WorkspacePanel = lazy(() => import('./threads/PullRequestWorkspacePanel.js').then((module) => ({ default: module.PullRequestWorkspacePanel })));
const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
  Host: requiredCapability(pullRequestsRendererHostCapability),
});
export const pullRequestsRendererFeature = defineRendererFeature({
  definition: pullRequestsFeature, dependencies, messages: [pullRequestsMessages],
  provides: [declareCapabilityProvider(threadPullRequestsStateCapability)],
  setup(context) {
    const client = createPullRequestsClient(context.dependencies.transport);
    const connectionState = new PullRequestConnectionState(client);
    const threadState = new ThreadPullRequestsState(client);
    context.provide(declareCapabilityProvider(threadPullRequestsStateCapability), threadState);
    context.scope.add(threadState.dispose);
    context.scope.add(connectionState.dispose);
    const session = createPullRequestSession();
    const Host = context.dependencies.Host;
    context.ui.keyed(workspacePanelSlot, {
      id: 'pull-requests.detail', key: 'pull-request', priority: 10,
      render: ({ panelId, threadId }) => {
        const reference = pullRequestFromPanelId(panelId);
        return reference && threadId ? <Host>{(host) => <Suspense fallback={null}>
          <WorkspacePanel key={`${threadId}/${panelId}`} reference={reference} threadId={threadId} state={threadState} client={client} connectionState={connectionState} host={host} session={session} />
        </Suspense>}</Host> : null;
      },
    });
    context.ui.single(shellSidebarAvatarSlot, {
      id: 'pull-requests.account-avatar',
      render: (props) => <GitHubAccountAvatar {...props} state={connectionState} />,
    });
    context.ui.keyed(shellRouteSlot, {
      id: 'pull-requests.page', key: 'pull-requests', priority: 10,
      render: () => <Host>{(host) => <Suspense fallback={<section className="pr-workbench pr-workbench--connection"><main className="pr-empty pr-welcome"><PullRequestSkeleton kind="connection" label={host.translate('feature.pullRequests.loading')} /></main></section>}><Page client={client} connectionState={connectionState} session={session} host={host} /></Suspense>}</Host>,
    });
  },
});
