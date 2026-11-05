// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDiagnosticLogs } from '../../src/renderer/useDiagnosticLogs.js';

const mocks = vi.hoisted(() => ({ toast: { error: vi.fn() } }));
vi.mock('@setsuna-desktop/renderer-ui', async (original) => ({
  ...await original<typeof import('@setsuna-desktop/renderer-ui')>(), useToast: () => mocks.toast,
}));
const getDirectory = vi.fn();
const openDirectory = vi.fn();
const bridge = { getLogDirectory: getDirectory, openLogDirectory: openDirectory };
const translate = (key: string) => key;
beforeEach(() => {
  mocks.toast.error.mockReset();
  getDirectory.mockReset().mockResolvedValue('/local/logs');
  openDirectory.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('loads the location on demand and prevents duplicate file manager requests while opening', async () => {
  let finish!: () => void;
  openDirectory.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true }); }));
  expect(getDirectory).not.toHaveBeenCalled();
  const hook = renderHook(() => useDiagnosticLogs(bridge, translate));
  await waitFor(() => expect(hook.result.current.directory).toBe('/local/logs'));
  let request!: Promise<void>;
  act(() => {
    request = hook.result.current.openDirectory();
    void hook.result.current.openDirectory();
  });
  expect(hook.result.current.opening).toBe(true);
  expect(openDirectory).toHaveBeenCalledExactlyOnceWith();
  await act(async () => { finish(); await request; });
  expect(hook.result.current.opening).toBe(false);
  expect(mocks.toast.error).not.toHaveBeenCalled();
});

it('reports returned and rejected open failures through Toast and allows another attempt', async () => {
  openDirectory.mockResolvedValueOnce({ ok: false, error: 'No file manager' })
    .mockRejectedValueOnce(new Error('IPC unavailable'));
  const hook = renderHook(() => useDiagnosticLogs(bridge, translate));
  await waitFor(() => expect(hook.result.current.directory).toBe('/local/logs'));
  await act(async () => { await hook.result.current.openDirectory(); });
  await act(async () => { await hook.result.current.openDirectory(); });
  expect(mocks.toast.error.mock.calls).toEqual([['No file manager'], ['IPC unavailable']]);
  expect(hook.result.current.opening).toBe(false);
  await act(async () => { await hook.result.current.openDirectory(); });
  expect(openDirectory).toHaveBeenCalledTimes(3);
});

it('ignores a directory lookup that fails after leaving the settings page', async () => {
  let reject!: (error: Error) => void;
  getDirectory.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const hook = renderHook(() => useDiagnosticLogs(bridge, translate));
  await waitFor(() => expect(getDirectory).toHaveBeenCalledOnce());
  hook.unmount();
  await act(async () => { reject(new Error('Late response')); });
  expect(mocks.toast.error).not.toHaveBeenCalled();
});
