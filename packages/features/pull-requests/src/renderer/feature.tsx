import { lazy, Suspense } from 'react';
import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRendererDependencies, defineRendererFeature, rendererFeatureOperationTransportCapability } from '@setsuna-desktop/feature-core/renderer';
import { shellRouteSlot, shellSidebarAvatarSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { pullRequestsFeature } from '../contracts/index.js';
import { pullRequestsRendererHostCapability } from './host.js';
import { createPullRequestsClient } from './client.js';
import { createPullRequestSession } from './session.js';
import { PullRequestConnectionState } from './account/connection-state.js';
import { GitHubAccountAvatar } from './account/GitHubAccountAvatar.js';
import { pullRequestsMessages } from './messages.js';
import { PullRequestSkeleton } from './loading/PullRequestSkeleton.js';
import './pull-requests.css';

const Page = lazy(() => import('./PullRequestsPage.js').then((module) => ({ default: module.PullRequestsPage })));
const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
  Host: requiredCapability(pullRequestsRendererHostCapability),
});
export const pullRequestsRendererFeature = defineRendererFeature({
  definition: pullRequestsFeature, dependencies, messages: [pullRequestsMessages],
  setup(context) {
    const client = createPullRequestsClient(context.dependencies.transport);
    const connectionState = new PullRequestConnectionState(client);
    context.scope.add(connectionState.dispose);
    const session = createPullRequestSession();
    const Host = context.dependencies.Host;
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
