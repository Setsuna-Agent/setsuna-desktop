import type { PullRequestFilters, PullRequestReference } from '../contracts/index.js';
import { pullRequestKey } from '../contracts/index.js';
import { createPullRequestDetailData, createPullRequestListData, type PullRequestDetailData, type PullRequestListData } from './reading/session-data.js';

export type PullRequestScrollPosition = { top: number; left: number };
export type PullRequestDiffSession = {
  activePath: string | null; search: string; layout: 'unified' | 'split'; wrap: boolean;
  collapsed: ReadonlySet<string>;
};
export type PullRequestDetailSession = {
  diff: PullRequestDiffSession; scroll: Map<string, PullRequestScrollPosition>;
  data: PullRequestDetailData;
};
export const DEFAULT_PR_SIDEBAR_WIDTH = 340;
export type PullRequestSession = {
  repository: string; filters: PullRequestFilters; selected: PullRequestReference | null;
  sidebarWidth: number; listScroll: number; details: Map<string, PullRequestDetailSession>;
  list: PullRequestListData;
};
export function createPullRequestSession(): PullRequestSession {
  return { repository: '', filters: { state: 'all', author: '', search: '' }, selected: null, sidebarWidth: DEFAULT_PR_SIDEBAR_WIDTH, listScroll: 0, details: new Map(), list: createPullRequestListData() };
}

/** Owned by the renderer feature, so panel unmounts do not erase reading state. */
export function getPullRequestDetailSession(
  session: PullRequestSession, account: string, reference: PullRequestReference, threadId?: string,
): PullRequestDetailSession {
  const key = JSON.stringify([account.toLowerCase(), threadId ?? null, pullRequestKey(reference)]);
  let detail = session.details.get(key);
  if (!detail) {
    detail = {
      data: createPullRequestDetailData(),
      scroll: new Map(),
      diff: { activePath: null, search: '', layout: 'unified', wrap: true, collapsed: new Set() },
    };
    session.details.set(key, detail);
  }
  return detail;
}
