import { expect, it } from 'vitest';
import { reactionInputCodec, reactionResultCodec } from '../../src/contracts/index.js';
import { PullRequestReactionActions } from '../../src/runtime/reaction-actions.js';
import { commentNode, githubFixture, head, page, reference } from '../support/github-fixture.js';

const input = { ...reference, subjectId: 'C1', expectedAccount: 'alice', content: 'HEART', action: 'add' } as const;
const identity = { number: reference.number, repository: { nameWithOwner: reference.repository } };
const groups = (selected: boolean) => [{ content: 'HEART', viewerHasReacted: selected, users: { totalCount: selected ? 3 : 2 } }];
const subject = (typename = 'IssueComment') => ({
  id: 'C1', __typename: typename, viewerCanReact: true, reactionGroups: groups(false),
  ...identity, pullRequest: identity,
});

it.each(['PullRequest', 'IssueComment', 'PullRequestReview', 'PullRequestReviewComment'])('adds and removes a reaction scoped to its %s and account', async (typename) => {
  let selected = false;
  const { api } = githubFixture(({ path, query, variables }) => {
    if (path === '/user') return { login: 'Alice' };
    if (query.includes('mutation(')) {
      expect(variables.input).toEqual({ subjectId: 'C1', content: 'HEART' });
      selected = query.includes('addReaction');
      return { [selected ? 'addReaction' : 'removeReaction']: { subject: { ...subject(typename), reactionGroups: groups(selected) } } };
    }
    return { node: { ...subject(typename), reactionGroups: groups(selected) } };
  });
  const actions = new PullRequestReactionActions(api);
  expect(reactionResultCodec.parse(await actions.set(reactionInputCodec.parse(input))).reactions).toEqual([{ content: 'HEART', count: 3, viewerHasReacted: true }]);
  expect((await actions.set({ ...input, action: 'remove' })).reactions).toEqual([{ content: 'HEART', count: 2, viewerHasReacted: false }]);
});

it.each(['other-pr', 'other-repo', 'no-permission', 'account-changed'])('rejects %s before sending any mutation', async (reason) => {
  let accounts = 0;
  const { api, request } = githubFixture(({ path }) => {
    if (path === '/user') return { login: reason === 'account-changed' && ++accounts > 1 ? 'bob' : 'alice' };
    return { node: { ...subject(), viewerCanReact: reason !== 'no-permission', pullRequest: {
      number: reason === 'other-pr' ? 99 : reference.number,
      repository: { nameWithOwner: reason === 'other-repo' ? 'owner/other' : reference.repository },
    } } };
  });
  await expect(new PullRequestReactionActions(api).set(input)).rejects.toMatchObject({
    code: reason === 'account-changed' ? 'PR_ACCOUNT_CHANGED' : reason === 'no-permission' ? 'PR_ACTION_BLOCKED' : 'PR_NOT_FOUND',
  });
  expect(request.mock.calls.some(([, init]) => JSON.parse(String(init?.body ?? '{}')).query?.includes('mutation('))).toBe(false);
});

it('retries a lost response by reconciling the desired state without applying another mutation', async () => {
  let selected = false;
  let mutations = 0;
  const { api } = githubFixture(({ path, query }) => {
    if (path === '/user') return { login: 'alice' };
    if (query.includes('mutation(')) { mutations += 1; selected = true; throw new Error('Response lost'); }
    return { node: { ...subject(), reactionGroups: groups(selected) } };
  });
  const actions = new PullRequestReactionActions(api);
  await expect(actions.set(input)).rejects.toThrow('Response lost');
  expect((await actions.set(input)).reactions[0].viewerHasReacted).toBe(true);
  expect(mutations).toBe(1);
});

it('requires commit comments to appear in the selected PR, including later pages', async () => {
  let found = false;
  const { api } = githubFixture(({ path, query, variables }) => {
    if (path === '/user') return { login: 'alice' };
    if (query.includes('mutation(')) return { addReaction: { subject: { ...subject('CommitComment'), reactionGroups: groups(true) } } };
    if (query.includes('timelineItems(')) return { repository: { pullRequest: {
      timelineItems: variables.cursor ? page(found ? [{ id: 'T1', commit: { oid: head }, comments: page([commentNode('C1')]) }] : []) : page([], 'next'),
    } } };
    return { node: subject('CommitComment') };
  });
  const actions = new PullRequestReactionActions(api);
  await expect(actions.set(input)).rejects.toMatchObject({ code: 'PR_NOT_FOUND' });
  found = true;
  expect((await actions.set(input)).reactions[0].viewerHasReacted).toBe(true);
});
