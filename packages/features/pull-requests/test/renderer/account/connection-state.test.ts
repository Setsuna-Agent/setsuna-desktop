// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestConnection } from '../../../src/contracts/index.js';
import type { PullRequestsClient } from '../../../src/renderer/client.js';
import { PullRequestConnectionState } from '../../../src/renderer/account/connection-state.js';

const states: PullRequestConnectionState[] = [];
afterEach(() => { for (const state of states.splice(0)) state.dispose(); });
const account = (login: string): PullRequestConnection => ({
  state: 'connected', login, avatarUrl: `https://avatars.githubusercontent.com/${login}`,
  error: null, loginCommand: 'gh auth login --hostname github.com --web',
});
function createState(connection: PullRequestsClient['connection']) {
  const state = new PullRequestConnectionState({ connection });
  states.push(state);
  return state;
}

describe('shared GitHub CLI connection', () => {
  it('starts lazily, shares account changes between consumers and stops after the last unsubscribe', async () => {
    const signedOut: PullRequestConnection = { ...account('alice'), state: 'signed-out', login: null, avatarUrl: null };
    const connection = vi.fn().mockResolvedValueOnce(account('alice')).mockResolvedValueOnce(account('bob')).mockResolvedValueOnce(signedOut);
    const state = createState(connection);
    expect(connection).not.toHaveBeenCalled();
    const sidebar = vi.fn();
    const page = vi.fn();
    const unsubscribeSidebar = state.subscribe(sidebar);
    const unsubscribePage = state.subscribe(page);
    await vi.waitFor(() => expect(state.getSnapshot().connection?.login).toBe('alice'));
    expect(connection).toHaveBeenCalledOnce();
    sidebar.mockClear(); page.mockClear();

    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(state.getSnapshot().connection).toEqual(account('bob')));
    expect(connection).toHaveBeenCalledTimes(2);
    expect(sidebar).toHaveBeenCalled();
    expect(page).toHaveBeenCalled();
    unsubscribePage();
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(state.getSnapshot().connection).toEqual(signedOut));
    unsubscribeSidebar();
    window.dispatchEvent(new Event('focus'));
    expect(connection).toHaveBeenCalledTimes(3);
  });

  it('cancels replaced and unused requests without accepting their late results', async () => {
    const requests: { signal: AbortSignal; resolve: (value: PullRequestConnection) => void }[] = [];
    const connection = vi.fn<PullRequestsClient['connection']>((_input, signal) => new Promise((resolve) => {
      requests.push({ signal: signal!, resolve });
    }));
    const state = createState(connection);
    const unsubscribe = state.subscribe(vi.fn());
    const latest = state.refresh();
    expect(requests[0].signal.aborted).toBe(true);
    requests[1].resolve(account('bob'));
    await latest;
    requests[0].resolve(account('alice'));
    await Promise.resolve();
    expect(state.getSnapshot().connection?.login).toBe('bob');

    const pending = state.refresh();
    unsubscribe();
    expect(requests[2].signal.aborted).toBe(true);
    requests[2].resolve(account('carol'));
    await pending;
    expect(state.getSnapshot()).toMatchObject({ connection: account('bob'), pending: false });
  });

  it('clears a stale account on connection failure and recovers on the next check', async () => {
    const connection = vi.fn().mockResolvedValueOnce(account('alice'))
      .mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(account('bob'));
    const state = createState(connection);
    state.subscribe(vi.fn());
    await vi.waitFor(() => expect(state.getSnapshot().connection?.login).toBe('alice'));
    await state.refresh();
    expect(state.getSnapshot()).toEqual({ connection: null, error: 'Connection lost', pending: false });
    await state.refresh();
    expect(state.getSnapshot()).toEqual({ connection: account('bob'), error: '', pending: false });
  });

  it('aborts work and detaches listeners when the feature is disposed', async () => {
    const connection = vi.fn<PullRequestsClient['connection']>(() => new Promise(() => undefined));
    const state = createState(connection);
    state.subscribe(vi.fn());
    const signal = connection.mock.calls[0][1];
    state.dispose();
    expect(signal?.aborted).toBe(true);
    window.dispatchEvent(new Event('focus'));
    state.subscribe(vi.fn());
    await state.refresh();
    expect(connection).toHaveBeenCalledOnce();
  });
});
