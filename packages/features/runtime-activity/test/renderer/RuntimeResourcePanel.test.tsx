// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProcessResourceSample, RuntimeActivityRendererService } from '../../src/contracts/index.js';
import { RuntimeResourcePanel } from '../../src/renderer/RuntimeResourcePanel.js';
import { runtimeActivityTestTranslate } from './support.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('requires confirmation, preserves a rejected target for retry and refreshes after termination', async () => {
  const user = userEvent.setup();
  const guest: ProcessResourceSample = { pid: 20, startedAt: 100, type: 'Tab', name: '', cpuTimeSeconds: 1, residentBytes: 1024,
    canTerminate: true, pages: [{ id: 1, title: 'Page', url: 'https://example.test' }] };
  const protectedProcess = { ...guest, pid: 10, type: 'Browser', canTerminate: false, pages: [] };
  let processes = [guest, protectedProcess];
  const desktop = {
    sampleResources: vi.fn(async () => ({ sampledAt: performance.now(), processes })),
    terminateResourceProcess: vi.fn().mockResolvedValueOnce('stale').mockImplementationOnce(async () => {
      processes = [protectedProcess];
      return 'terminated';
    }),
  };
  const service = { sampleResources: vi.fn(async () => ({ sampledAt: performance.now(), processes: [] })) } as unknown as RuntimeActivityRendererService;
  render(<RuntimeResourcePanel desktopBridge={desktop} service={service} translate={runtimeActivityTestTranslate} />);
  const terminate = await screen.findByRole('button', { name: '终止进程 20' });
  fireEvent.click(screen.getByRole('button', { name: '终止进程 10' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(terminate);
  let dialog = within(await screen.findByRole('dialog', { name: '终止进程 20？' }));
  await user.click(dialog.getByRole('button', { name: '取消' }));
  expect(desktop.terminateResourceProcess).not.toHaveBeenCalled();

  await user.click(terminate);
  dialog = within(await screen.findByRole('dialog', { name: '终止进程 20？' }));
  await user.click(dialog.getByRole('button', { name: '终止', exact: true }));
  expect(await screen.findByText(/进程或关联页面已变化/u)).toBeTruthy();
  expect(desktop.terminateResourceProcess).toHaveBeenCalledExactlyOnceWith({ pid: 20, startedAt: 100, pageIds: [1] });
  await user.click(dialog.getByRole('button', { name: '终止', exact: true }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '终止进程 20' })).toBeNull());
  expect(desktop.terminateResourceProcess).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('requires a new selection when polling replaces the confirmed pages even with the same process and page count', async () => {
  vi.useFakeTimers();
  let pages = [{ id: 1, title: 'First page', url: 'https://first.test' }];
  const desktop = {
    sampleResources: vi.fn(async () => ({ sampledAt: performance.now(), processes: [{
      pid: 20, startedAt: 100, type: 'Tab', name: '', cpuTimeSeconds: 1, residentBytes: 1024, canTerminate: true, pages,
    }] })),
    terminateResourceProcess: vi.fn(async () => 'terminated' as const),
  };
  const service = { sampleResources: vi.fn(async () => ({ sampledAt: performance.now(), processes: [] })) } as unknown as RuntimeActivityRendererService;
  render(<RuntimeResourcePanel desktopBridge={desktop} service={service} translate={runtimeActivityTestTranslate} />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(screen.getByRole('button', { name: '终止进程 20' }));
  let dialog = within(screen.getByRole('dialog', { name: '终止进程 20？' }));
  pages = [{ id: 2, title: 'Replacement page', url: 'https://second.test' }];
  await act(() => vi.advanceTimersByTimeAsync(2_000));
  expect(desktop.sampleResources).toHaveBeenCalledTimes(2);
  await act(async () => fireEvent.click(dialog.getByRole('button', { name: '终止', exact: true })));
  expect(screen.getByText(/进程或关联页面已变化/u)).toBeTruthy();
  expect(desktop.terminateResourceProcess).not.toHaveBeenCalled();

  fireEvent.click(dialog.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '终止进程 20' }));
  dialog = within(screen.getByRole('dialog', { name: '终止进程 20？' }));
  await act(async () => fireEvent.click(dialog.getByRole('button', { name: '终止', exact: true })));
  expect(desktop.terminateResourceProcess).toHaveBeenCalledExactlyOnceWith({ pid: 20, startedAt: 100, pageIds: [2] });
});
