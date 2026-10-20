import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { RuntimeInterfaceLanguage, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { reference, summary, type PullRequestReference } from './models.js';
import { array, codec, nullable, object, positiveInteger, repositoryId, text } from './schema.js';

export const ATTACH_PULL_REQUEST_TOOL = 'attach_pull_request';
export const attachedPullRequest = object({ repository: repositoryId, number: positiveInteger, url: text(8192), attachedAt: text(50) });
export type AttachedPullRequest = ReturnType<typeof attachedPullRequest>;
export const threadPullRequest = object({ attachment: attachedPullRequest, summary: nullable(summary), error: nullable(text()) });
export type ThreadPullRequest = ReturnType<typeof threadPullRequest>;
export const threadPullRequestsInput = codec(object({ threadIds: (value: unknown) => {
  const ids = array(text(256, /\S/u))(value);
  if (ids.length > 50) throw new Error('Too many conversations.');
  return [...new Set(ids)];
} }));
export const threadPullRequestsResult = codec(object({ threads: array(object({ threadId: text(256), items: array(threadPullRequest), error: nullable(text()) })) }));
export type ThreadPullRequestsResult = ReturnType<typeof threadPullRequestsResult.parse>;

/** A canonical GitHub PR identity is also the tab identity, independent of title or state. */
export function pullRequestKey(pr: PullRequestReference): string { return `${pr.repository.toLowerCase()}#${pr.number}`; }
export function pullRequestUrl(pr: PullRequestReference): string { return `https://github.com/${pr.repository}/pull/${pr.number}`; }
export function parsePullRequestUrl(value: unknown): PullRequestReference | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return null;
    const match = /^\/([^/]+\/[^/]+)\/pull\/([1-9]\d*)\/?$/u.exec(url.pathname);
    return match ? reference({ repository: match[1].toLowerCase(), number: Number(match[2]) }) : null;
  } catch { return null; }
}
export const pullRequestPanelId = (pr: PullRequestReference) => `pull-request:${pullRequestKey(pr)}`;
export function pullRequestFromPanelId(id: string): PullRequestReference | null {
  const match = /^pull-request:(.+)#([1-9]\d*)$/u.exec(id);
  try { return match ? reference({ repository: match[1], number: Number(match[2]) }) : null; }
  catch { return null; }
}

export type PullRequestToolContext = { interfaceLanguage?: RuntimeInterfaceLanguage; readOnly?: boolean };
export type PullRequestToolService = {
  listTools(context: PullRequestToolContext): RuntimeToolDefinition[];
  systemPrompt(context: PullRequestToolContext): string | null;
  attach(input: unknown): { content: string; data: { resultKind: 'pull-requests.attachment'; reference: PullRequestReference } };
};
export const pullRequestToolServiceCapability = defineCapability<PullRequestToolService>({
  id: 'pull-requests.tools', description: 'Attach created pull requests to the source conversation',
});

export type ThreadPullRequestsStateService = {
  subscribe(threadId: string, listener: () => void): () => void;
  getSnapshot(threadId: string): readonly ThreadPullRequest[];
  refresh(): void;
};
export const threadPullRequestsStateCapability = defineCapability<ThreadPullRequestsStateService>({
  id: 'pull-requests.thread-state', description: 'Shared conversation PR associations and current GitHub status',
});
