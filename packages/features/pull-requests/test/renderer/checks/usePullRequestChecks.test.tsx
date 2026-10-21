// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PullRequestCheck } from '../../../src/contracts/index.js';
import type { PullRequestsClient } from '../../../src/renderer/client.js';
import { PullRequestChecks } from '../../../src/renderer/PullRequestChecks.js';
import { usePullRequestChecks } from '../../../src/renderer/checks/usePullRequestChecks.js';
import { createPullRequestDetailData } from '../../../src/renderer/reading/session-data.js';
import { readRequest } from '../../../src/runtime/pull-requests.js';
import { githubFixture, reference, repositoryNode } from '../../support/github-fixture.js';
import { RendererHost } from '../../support/renderer-host.js';

afterEach(cleanup);
const detail = () => readRequest(githubFixture(() => ({ repository: repositoryNode() })).api, reference);
const check = (id: string, summary = id): PullRequestCheck => ({
  id, name: id, source: 'CI', state: 'COMPLETED', conclusion: 'FAILURE', required: true,
  url: null, startedAt: null, completedAt: null, summary,
});
type Page = { items: PullRequestCheck[]; cursor: string | null };
function deferred() {
  let resolve!: (page: Page) => void;
  const promise = new Promise<Page>((done) => { resolve = done; });
  return { promise, resolve };
}

it('keeps later pages and the reader’s expansion through a paginated refresh and a failed refresh', async () => {
  const pr = await detail();
  const checks = vi.fn<PullRequestsClient['checks']>().mockImplementation(async ({ cursor }) =>
    ({ items: [check(cursor ? 'second' : 'first')], cursor: cursor ? null : 'next' }));
  const client = { checks } as unknown as PullRequestsClient;
  const data = createPullRequestDetailData();
  const view = render(<PullRequestChecks client={client} detail={pr} revision={0} data={data} />, { wrapper: RendererHost });
  const second = await screen.findByRole('button', { name: /second/ });
  fireEvent.click(second);
  expect(second.getAttribute('aria-expanded')).toBe('false');

  const page = deferred();
  checks.mockImplementationOnce(async () => ({ items: [check('first', 'updated first')], cursor: 'next' }))
    .mockImplementationOnce(() => page.promise);
  view.rerender(<PullRequestChecks client={client} detail={pr} revision={1} data={data} />);
  await waitFor(() => expect(checks).toHaveBeenCalledTimes(4));
  expect(screen.getByRole('button', { name: /second/ }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('updated first')).toBeNull();
  await act(async () => page.resolve({ items: [check('second', 'updated second')], cursor: null }));
  expect(screen.getByText('updated first')).toBeTruthy();
  expect(screen.getByRole('button', { name: /second/ }).getAttribute('aria-expanded')).toBe('false');

  checks.mockImplementationOnce(async () => ({ items: [check('first', 'partial replacement')], cursor: 'next' }))
    .mockRejectedValueOnce(new Error('Disconnected'));
  view.rerender(<PullRequestChecks client={client} detail={pr} revision={2} data={data} />);
  expect((await screen.findByRole('alert')).textContent).toContain('Disconnected');
  expect(screen.getByText('updated first')).toBeTruthy();
  expect(screen.queryByText('partial replacement')).toBeNull();
  expect(screen.getByRole('button', { name: /second/ }).getAttribute('aria-expanded')).toBe('false');
});

it('clears checks on commit changes and discards responses from cancelled refreshes', async () => {
  const pr = await detail();
  const checks = vi.fn<PullRequestsClient['checks']>().mockResolvedValue({ items: [check('old')], cursor: null });
  const client = { checks } as unknown as PullRequestsClient;
  const data = createPullRequestDetailData();
  const hook = renderHook(({ commit, revision }) => usePullRequestChecks(client, { ...pr, checksCommit: commit }, revision, data),
    { initialProps: { commit: pr.checksCommit, revision: 0 } });
  await waitFor(() => expect(hook.result.current.pending).toBe(false));
  const stale = deferred();
  checks.mockImplementationOnce(() => stale.promise);
  hook.rerender({ commit: pr.checksCommit, revision: 1 });
  const oldSignal = checks.mock.calls.at(-1)![1]!;
  const current = deferred();
  checks.mockImplementationOnce(() => current.promise);
  hook.rerender({ commit: 'd'.repeat(40), revision: 1 });
  expect(oldSignal.aborted).toBe(true);
  expect(hook.result.current.items).toEqual([]);
  await act(async () => current.resolve({ items: [check('current')], cursor: null }));
  await act(async () => stale.resolve({ items: [check('stale')], cursor: null }));
  expect(hook.result.current.items.map((item) => item.id)).toEqual(['current']);
  hook.rerender({ commit: null, revision: 1 });
  await waitFor(() => expect(hook.result.current.pending).toBe(false));
  expect(hook.result.current.items).toEqual([]);
});
