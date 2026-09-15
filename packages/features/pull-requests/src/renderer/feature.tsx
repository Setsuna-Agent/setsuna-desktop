import { lazy, Suspense } from 'react';
import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRendererDependencies, defineRendererFeature, rendererFeatureOperationTransportCapability } from '@setsuna-desktop/feature-core/renderer';
import { shellRouteSlot } from '@setsuna-desktop/renderer-contracts/shell';
import { pullRequestsFeature } from '../contracts/index.js';
import { pullRequestsRendererHostCapability } from './host.js';
import { createPullRequestsClient } from './client.js';
import { createPullRequestSession } from './session.js';
import { pullRequestsMessages } from './messages.js';
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
    const session = createPullRequestSession();
    const Host = context.dependencies.Host;
    context.ui.keyed(shellRouteSlot, {
      id: 'pull-requests.page', key: 'pull-requests', priority: 10,
      render: () => <Host>{(host) => <Suspense fallback={<div className="pr-loading" role="status">{host.translate('feature.pullRequests.loading')}</div>}><Page client={client} session={session} host={host} /></Suspense>}</Host>,
    });
  },
});
