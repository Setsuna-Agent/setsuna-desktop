import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { WorkspaceProjectList } from '@setsuna-desktop/contracts';

export const pullRequestsWorkspaceCapability = defineCapability<{
  listProjects(): Promise<WorkspaceProjectList>;
}>({ id: 'pull-requests.workspace', description: 'Saved workspace projects used to discover GitHub remotes' });

export type GitHubCliInstallationHost = {
  dataDir: string;
  fetch(url: string, init?: RequestInit): Promise<Response>;
};
export const githubCliInstallationHostCapability = defineCapability<GitHubCliInstallationHost>({
  id: 'pull-requests.cli-installation-host', description: 'Application data directory and routed downloads for GitHub CLI',
});
