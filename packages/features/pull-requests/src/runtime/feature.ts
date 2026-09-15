import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRuntimeDependencies, defineRuntimeFeature, runtimeRouteRegistrarCapability } from '@setsuna-desktop/feature-core/runtime';
import * as operations from '../contracts/operations.js';
import { githubCliInstallationHostCapability, pullRequestsWorkspaceCapability } from '../contracts/index.js';
import { GitHubApi } from './github-api.js';
import { GitHubCli } from './github-cli.js';
import { GitHubCliInstaller, managedGitHubCliPath } from './github-cli-installation.js';
import { PullRequestRepositories } from './repositories.js';
import { listRequests, readRequest } from './pull-requests.js';
import { comment, readDiscussions, readThread } from './discussions.js';
import { nextCursor } from './github-api.js';
import { readChecks } from './checks.js';
import { PullRequestFiles } from './files.js';
import { commentNotSentFailure, PullRequestActions } from './actions.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  workspace: requiredCapability(pullRequestsWorkspaceCapability),
  installation: requiredCapability(githubCliInstallationHostCapability),
});

export const pullRequestsRuntimeFeature = defineRuntimeFeature({
  definition: operations.pullRequestsFeature,
  dependencies,
  setup(context) {
    const { routes, workspace, installation } = context.dependencies;
    const github = new GitHubCli(managedGitHubCliPath(installation.dataDir));
    const installer = new GitHubCliInstaller(installation, { isInstalled: (signal) => github.isInstalled(signal) });
    const api = new GitHubApi(github);
    const repositories = new PullRequestRepositories(workspace);
    const files = new PullRequestFiles(api);
    const actions = new PullRequestActions(api);
    context.scope.add(() => files.clear());
    context.scope.add(() => installer.dispose());
    routes.register(context.scope, operations.readGitHubCliInstallation, () => installer.read());
    routes.register(context.scope, operations.installGitHubCli, () => installer.start());
    routes.register(context.scope, operations.readPullRequestConnection, (_, { signal }) => github.status(signal));
    routes.register(context.scope, operations.readPullRequestRepositories, (_, { signal }) => repositories.list(signal));
    routes.register(context.scope, operations.listPullRequests, async (input, { signal }) => {
      await repositories.root(input.repository, signal);
      return listRequests(api, input, signal);
    });
    routes.register(context.scope, operations.readPullRequest, async (input, { signal }) => {
      await repositories.root(input.repository, signal);
      return readRequest(api, input, signal);
    });
    routes.register(context.scope, operations.readPullRequestDiscussions, async (input, { signal }) => {
      await repositories.root(input.repository, signal);
      return readDiscussions(api, input, signal);
    });
    routes.register(context.scope, operations.readPullRequestReplies, async (input, { signal }) => {
      await repositories.root(input.repository, signal);
      const thread = await readThread(api, input, signal);
      return { comments: thread.comments.nodes.map(comment), cursor: nextCursor(thread.comments) };
    });
    routes.register(context.scope, operations.readPullRequestChecks, async (input, { signal }) => {
      await repositories.root(input.repository, signal);
      return readChecks(api, input, signal);
    });
    routes.register(context.scope, operations.readPullRequestFiles, async (input, { signal }) => files.list(input, await repositories.root(input.repository, signal), signal));
    routes.register(context.scope, operations.readPullRequestPatch, async (input, { signal }) => files.patch(input, await repositories.root(input.repository, signal), signal));
    routes.register(context.scope, operations.publishPullRequestComment, async (input, { signal }) => {
      try { await repositories.root(input.repository, signal, true); }
      catch (error) { throw input.reconcileOnly ? error : commentNotSentFailure(error); }
      return actions.publish(input, signal);
    });
    routes.register(context.scope, operations.performPullRequestAction, async (input, { signal }) => {
      await repositories.root(input.repository, signal, true);
      return actions.act(input, signal);
    });
  },
});
