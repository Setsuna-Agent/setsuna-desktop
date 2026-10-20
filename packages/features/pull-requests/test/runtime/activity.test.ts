import { expect, it } from 'vitest';
import { activityResultCodec } from '../../src/contracts/index.js';
import { readActivity } from '../../src/runtime/activity.js';
import { githubFixture, head, page, reference } from '../support/github-fixture.js';

it('reads lifecycle and commit history with original actors, timestamps and pagination', async () => {
  const author = { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/1' };
  const { api } = githubFixture(({ variables }) => ({ repository: { pullRequest: { timelineItems: variables.cursor
    ? page([{ __typename: 'AutoMergeDisabledEvent', id: 'E2', createdAt: '2026-10-20T03:00:00Z', actor: null }])
    : page([
      { __typename: 'PullRequestCommit', id: 'C1', commit: { oid: head, messageHeadline: 'Fix', committedDate: '2026-10-20T01:00:00Z', url: 'https://github.com/owner/repo/commit/123', author: { user: author } } },
      { __typename: 'AutoSquashEnabledEvent', id: 'E1', createdAt: '2026-10-20T02:00:00Z', actor: author },
    ], 'next') } } }));
  const first = activityResultCodec.parse(await readActivity(api, { ...reference, cursor: null }));
  expect(first.items).toMatchObject([
    { kind: 'commit', createdAt: '2026-10-20T01:00:00Z', actor: author, commit: { sha: head, message: 'Fix' } },
    { kind: 'auto-squash-enabled', createdAt: '2026-10-20T02:00:00Z', actor: author, commit: null },
  ]);
  const next = activityResultCodec.parse(await readActivity(api, { ...reference, cursor: first.cursor }));
  expect(next).toEqual({ items: [{ id: 'E2', kind: 'auto-merge-disabled', createdAt: '2026-10-20T03:00:00Z', actor: null, commit: null }], cursor: null });
});

it('reports unavailable or partially failed history instead of returning an empty timeline', async () => {
  const missing = githubFixture(() => ({ repository: { pullRequest: null } }));
  await expect(readActivity(missing.api, { ...reference, cursor: null })).rejects.toMatchObject({ code: 'PR_NOT_FOUND' });
  const partial = githubFixture(() => Response.json({ data: { repository: {} }, errors: [{ message: 'Unavailable' }] }));
  await expect(readActivity(partial.api, { ...reference, cursor: null })).rejects.toMatchObject({ code: 'GITHUB_REQUEST_FAILED' });
});
