import type { PullRequestFilters, PullRequestReference } from '../contracts/index.js';

export type PullRequestTab = 'overview' | 'diff' | 'checks';
export const DEFAULT_PR_SIDEBAR_WIDTH = 340;
export type PullRequestSession = {
  repository: string; filters: PullRequestFilters; selected: PullRequestReference | null; tab: PullRequestTab;
  sidebarWidth: number; listScroll: number; detailScroll: Map<string, number>;
};
export function createPullRequestSession(): PullRequestSession {
  return { repository: '', filters: { state: 'all', author: '', search: '' }, selected: null, tab: 'overview', sidebarWidth: DEFAULT_PR_SIDEBAR_WIDTH, listScroll: 0, detailScroll: new Map() };
}
