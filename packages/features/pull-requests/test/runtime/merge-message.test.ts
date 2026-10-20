import { describe, expect, it } from 'vitest';
import { actionInputCodec, mergeMessageCodec } from '../../src/contracts/index.js';
import { PullRequestActions } from '../../src/runtime/actions.js';
import { readMergeMessage } from '../../src/runtime/merge-message.js';
import { githubFixture, head, reference, repositoryNode } from '../support/github-fixture.js';

const reviewed = { ...reference, expectedAccount: 'alice', headSha: head, baseBranch: 'main' };

describe('merge commit messages', () => {
  it.each(['MERGE', 'SQUASH'] as const)('reads GitHub defaults for %s at the reviewed revision', async (method) => {
    const defaults = { title: `${method} title`, body: '* First commit\n\n* Second commit' };
    const { api, request } = githubFixture(({ variables }) => {
      expect(variables).toEqual({ owner: 'owner', name: 'repo', number: reference.number, method });
      return { viewer: { login: 'ALICE' }, repository: { pullRequest: { headRefOid: head, baseRefName: 'main', ...defaults } } };
    });
    expect(mergeMessageCodec.parse(await readMergeMessage(api, { ...reviewed, method }))).toEqual(defaults);
    expect(request).toHaveBeenCalledOnce();
  });

  it.each(['account', 'revision', 'target'] as const)('refuses defaults from a changed %s', async (change) => {
    const { api } = githubFixture(() => ({
      viewer: { login: change === 'account' ? 'bob' : 'alice' },
      repository: { pullRequest: {
        headRefOid: change === 'revision' ? 'b'.repeat(40) : head, baseRefName: change === 'target' ? 'develop' : 'main',
        title: 'Title', body: 'Body',
      } },
    }));
    await expect(readMergeMessage(api, { ...reviewed, method: 'SQUASH' })).rejects.toMatchObject({
      code: change === 'account' ? 'PR_ACCOUNT_CHANGED' : 'PR_CHANGED',
    });
  });

  it.each([
    ['MERGE', 'merge'], ['SQUASH', 'merge'], ['MERGE', 'enable-auto-merge'], ['SQUASH', 'enable-auto-merge'],
  ] as const)('sends the edited %s message through %s, including an explicitly empty body', async (method, action) => {
    const commitMessage = { title: 'User edited title', body: method === 'MERGE' ? 'First paragraph\n\nSecond paragraph' : '' };
    const writes: unknown[] = [];
    const { api } = githubFixture(({ path, query, body, variables }) => {
      if (path === '/user') return { login: 'alice' };
      if (query.includes('viewerPermission')) return { repository: repositoryNode() };
      if (path.endsWith('/merge')) { writes.push(body); return { merged: true }; }
      if (query.includes('mutation')) { writes.push(variables.input); return {}; }
      throw new Error('Unexpected request');
    });
    await new PullRequestActions(api).act(actionInputCodec.parse({ ...reviewed, action, method, commitMessage }));
    expect(writes).toEqual([action === 'merge'
      ? { sha: head, merge_method: method.toLowerCase(), commit_title: commitMessage.title, commit_message: commitMessage.body }
      : { pullRequestId: 'PR_12', mergeMethod: method, commitHeadline: commitMessage.title, commitBody: commitMessage.body }]);
  });

  it.each(['rebase', 'queue'] as const)('refuses custom messages for %s instead of silently ignoring edits', async (mode) => {
    const repository = repositoryNode();
    repository.rebaseMergeAllowed = true;
    repository.pullRequest.mergeQueue = mode === 'queue' ? { id: 'Q1' } : null;
    let writes = 0;
    const { api } = githubFixture(({ path, query }) => {
      if (path === '/user') return { login: 'alice' };
      if (query.includes('viewerPermission')) return { repository };
      writes += 1;
      return { merged: true };
    });
    await expect(new PullRequestActions(api).act({
      ...reviewed, method: mode === 'queue' ? 'MERGE' : 'REBASE', action: mode === 'queue' ? 'enqueue' : 'merge',
      commitMessage: { title: 'Custom', body: 'Body' },
    })).rejects.toMatchObject({ code: 'PR_ACTION_BLOCKED' });
    expect(writes).toBe(0);
  });
});
