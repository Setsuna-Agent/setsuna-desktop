// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PullRequestActivityEvent, PullRequestActivityResult } from '../../../src/contracts/index.js';
import type { PullRequestsClient } from '../../../src/renderer/client.js';
import { usePullRequestActivity } from '../../../src/renderer/activity/usePullRequestActivity.js';
import { pullRequestTimeline } from '../../../src/renderer/activity/timeline.js';
import { readRequest } from '../../../src/runtime/pull-requests.js';
import { commentNode, githubFixture, reference, repositoryNode } from '../../support/github-fixture.js';

afterEach(cleanup);
const event = (id: string): PullRequestActivityEvent => ({ id, kind: 'auto-merge-enabled', createdAt: '2026-09-14T02:00:00Z', actor: null, commit: null });

it('retains loaded history on refresh failure and ignores cancelled pagination responses', async () => {
  const activity = vi.fn<PullRequestsClient['activity']>().mockImplementation(async ({ cursor }) => ({
    items: [event(cursor ? 'second' : 'first')], cursor: cursor ? null : 'next',
  }));
  const client = { activity } as unknown as PullRequestsClient;
  const hook = renderHook(({ revision }) => usePullRequestActivity(client, reference, revision), { initialProps: { revision: 0 } });
  await waitFor(() => expect(hook.result.current.pending).toBe(false));
  await act(() => hook.result.current.more());
  expect(hook.result.current.items.map((item) => item.id)).toEqual(['first', 'second']);

  activity.mockRejectedValueOnce(new Error('Disconnected'));
  hook.rerender({ revision: 1 });
  await waitFor(() => expect(hook.result.current.error).toBe('Disconnected'));
  expect(hook.result.current.items.map((item) => item.id)).toEqual(['first', 'second']);
  act(() => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.pending).toBe(false));
  expect(hook.result.current.error).toBe('');
  expect(hook.result.current.items.map((item) => item.id)).toEqual(['first', 'second']);

  let resolve!: (result: PullRequestActivityResult) => void;
  activity.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  hook.rerender({ revision: 2 });
  const oldSignal = activity.mock.calls.at(-1)![1]!;
  activity.mockResolvedValue({ items: [event('current')], cursor: null });
  hook.rerender({ revision: 3 });
  await waitFor(() => expect(hook.result.current.items[0].id).toBe('current'));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => resolve({ items: [event('stale')], cursor: null }));
  expect(hook.result.current.items.map((item) => item.id)).toEqual(['current']);
});

it('interleaves creation, comments and lifecycle events using their occurrence time', async () => {
  const detail = await readRequest(githubFixture(() => ({ repository: repositoryNode() })).api, reference);
  const discussion = {
    id: 'D1', kind: 'comment' as const, state: null, resolved: false, outdated: false, canReply: true,
    path: null, line: null, side: null, diffHunk: null, commitSha: null, comments: [commentNode('C1')], replyCursor: null,
  };
  const items = pullRequestTimeline(detail, [event('enabled')], [discussion]);
  expect(items.map((item) => item.kind === 'event' ? item.event.kind : item.kind)).toEqual(['opened', 'discussion', 'auto-merge-enabled']);
  expect(items[0]).toMatchObject({ event: { createdAt: detail.createdAt, actor: detail.author } });
});
