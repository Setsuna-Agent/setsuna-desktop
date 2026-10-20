// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PullRequestDetail } from '../../src/contracts/index.js';
import type { PullRequestsClient } from '../../src/renderer/client.js';
import { PullRequestsHostContext } from '../../src/renderer/context.js';
import { PullRequestDetailPane } from '../../src/renderer/PullRequestDetailPane.js';
import { createPullRequestSession, getPullRequestDetailSession } from '../../src/renderer/session.js';
import { readRequest } from '../../src/runtime/pull-requests.js';
import { githubFixture, reference, repositoryNode } from '../support/github-fixture.js';
import { rendererHost } from '../support/renderer-host.js';

afterEach(cleanup);

function deferred() {
  let resolve!: (value: PullRequestDetail) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<PullRequestDetail>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function setup() {
  const pr = await readRequest(githubFixture(() => ({ repository: repositoryNode() })).api, reference);
  const detail = vi.fn<PullRequestsClient['detail']>().mockResolvedValue(pr);
  const client = {
    detail, discussions: vi.fn(async () => ({ items: [], cursor: null })),
    activity: vi.fn(async () => ({ items: [], cursor: null })), checks: vi.fn(async () => ({ items: [], cursor: null })),
  } as unknown as PullRequestsClient;
  const session = getPullRequestDetailSession(createPullRequestSession(), 'alice', reference);
  const view = render(<PullRequestsHostContext.Provider value={rendererHost}>
    <PullRequestDetailPane client={client} reference={reference} account="alice" session={session} onUpdated={() => undefined} />
  </PullRequestsHostContext.Provider>);
  await waitFor(() => expect((screen.getByRole('button', { name: 'refresh' }) as HTMLButtonElement).disabled).toBe(false));
  return { pr, detail, view };
}

it('coalesces refreshes and keeps the detail visible through failure and a successful retry', async () => {
  const { pr, detail } = await setup();
  await act(async () => { fireEvent(window, new Event('focus')); });
  expect(detail).toHaveBeenCalledTimes(2);

  const pending = deferred();
  detail.mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
  const refresh = screen.getByRole('button', { name: 'refreshing' }) as HTMLButtonElement;
  expect(refresh.disabled).toBe(true);
  fireEvent.click(refresh);
  fireEvent(window, new Event('focus'));
  expect(detail).toHaveBeenCalledTimes(3);
  expect(detail.mock.calls.at(-1)![1]!.aborted).toBe(false);
  expect(screen.getByRole('heading', { level: 2 }).textContent).toContain(pr.title);

  await act(async () => { pending.reject(new Error('Connection lost')); });
  expect(screen.getByRole('alert').textContent).toContain('Connection lost');
  expect((screen.getByRole('button', { name: 'refresh' }) as HTMLButtonElement).disabled).toBe(false);

  const retry = deferred();
  detail.mockImplementationOnce(() => retry.promise);
  fireEvent.click(screen.getByRole('button', { name: 'retry' }));
  await act(async () => { retry.resolve({ ...pr, title: 'Updated PR title' }); });
  expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Updated PR title');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('cancels an unfinished manual refresh on leaving the PR', async () => {
  const { pr, detail, view } = await setup();
  const pending = deferred();
  detail.mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
  const signal = detail.mock.calls.at(-1)![1]!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(pr); });
});
