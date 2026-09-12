import { WORKSPACE_ENTRIES_WATCH_CHANNELS } from '@setsuna-desktop/contracts';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), on: vi.fn(), off: vi.fn(),
}));
vi.mock('electron', () => ({ ipcRenderer: mocks }));
import { watchWorkspaceEntries } from '../../src/workspace-entry-watch.js';

it('revalidates when watching becomes ready and drops notifications after cancellation', async () => {
  let ready!: () => void;
  const attaching = new Promise<void>((resolve) => { ready = resolve; });
  mocks.invoke.mockReturnValueOnce(attaching).mockResolvedValue(undefined);
  const changed = vi.fn();
  const stop = watchWorkspaceEntries('/repo', ['', 'src'], changed);
  const input = mocks.invoke.mock.calls[0][1];
  const listener = mocks.on.mock.calls[0][1];
  expect(input).toMatchObject({ workspaceRoot: '/repo', directoryPaths: ['', 'src'] });
  listener({}, { subscriptionId: 'foreign' });
  expect(changed).not.toHaveBeenCalled();
  ready();
  await attaching;
  expect(changed).toHaveBeenCalledOnce();
  listener({}, { subscriptionId: input.subscriptionId });
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
  listener({}, { subscriptionId: input.subscriptionId });
  expect(changed).toHaveBeenCalledTimes(2);
  expect(mocks.off).toHaveBeenCalledWith(WORKSPACE_ENTRIES_WATCH_CHANNELS.changed, listener);
  expect(mocks.invoke).toHaveBeenLastCalledWith(WORKSPACE_ENTRIES_WATCH_CHANNELS.unsubscribe, input.subscriptionId);

  const cancelled = watchWorkspaceEntries('/next', [''], changed);
  cancelled();
  await Promise.resolve();
  expect(changed).toHaveBeenCalledTimes(2);
});
