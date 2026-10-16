import type { ProcessMetric, WebContents, WebFrameMain } from 'electron';
import { expect, it, vi } from 'vitest';
import { projectDesktopResources, terminateResourceProcess } from '../../src/main/resources.js';

const isRendererSender = (id: number) => id === 9;
const metric = (pid: number, type = 'Tab', creationTime = 100) => ({ pid, type, creationTime,
  cpu: { cumulativeCPUUsage: 1 }, memory: { workingSetSize: 1 } }) as ProcessMetric;
function frameTree(pids: number[]) {
  const mainFrame = { osProcessId: pids[0], isDestroyed: () => false } as WebFrameMain;
  return Object.assign(mainFrame, { top: mainFrame,
    framesInSubtree: [mainFrame, ...pids.slice(1).map(osProcessId => ({ osProcessId, top: mainFrame, isDestroyed: () => false }))] });
}
function page(id: number, pid: number, overrides: Partial<WebContents> = {}) {
  return { id, getOSProcessId: () => pid, getTitle: () => 'Page', getURL: () => 'https://example.test',
    isDestroyed: () => false, isCrashed: () => false, getType: () => 'webview', mainFrame: frameTree([pid]),
    hostWebContents: { id: 9, isDestroyed: () => false }, forcefullyCrashRenderer: vi.fn(), ...overrides } as unknown as WebContents;
}

it('terminates the owned renderer only when PID creation time and all confirmed pages still match', () => {
  const pages = [page(1, 20), page(2, 20)];
  const metrics = [metric(20)];
  const target = { pid: 20, startedAt: 100, pageIds: [1, 2] };
  expect(terminateResourceProcess([metric(20, 'Tab', 200)], pages, isRendererSender, target)).toBe('stale');
  expect(terminateResourceProcess(metrics, pages, isRendererSender, { ...target, pageIds: [1] })).toBe('stale');
  expect(terminateResourceProcess(metrics, [...pages, page(3, 20)], isRendererSender, target)).toBe('stale');
  expect(terminateResourceProcess(metrics, pages, isRendererSender, { ...target, pid: 999 })).toBe('stale');
  expect(pages[0].forcefullyCrashRenderer).not.toHaveBeenCalled();
  expect(terminateResourceProcess(metrics, pages, isRendererSender, target)).toBe('terminated');
  expect(pages[0].forcefullyCrashRenderer).toHaveBeenCalledOnce();
  expect(pages[1].forcefullyCrashRenderer).not.toHaveBeenCalled();
});

it('protects host, extension, utility and incompletely inspected processes even for a forged request', () => {
  const guest = page(1, 20);
  const target = { pid: 20, startedAt: 100, pageIds: [1] };
  const host = page(2, 30, { getType: () => 'window', mainFrame: frameTree([30, 20]) });
  expect(terminateResourceProcess([metric(20)], [guest, host], isRendererSender, { ...target, pageIds: [1, 2] })).toBe('protected');
  const extension = page(1, 20, { getType: () => 'backgroundPage' });
  expect(terminateResourceProcess([metric(20)], [extension], isRendererSender, target)).toBe('protected');
  expect(terminateResourceProcess([metric(20, 'GPU')], [guest], isRendererSender, target)).toBe('protected');
  expect(terminateResourceProcess([metric(20, 'Utility')], [guest], isRendererSender, target)).toBe('protected');
  expect(terminateResourceProcess([metric(20)], [guest], () => false, target)).toBe('protected');
  const unknown = page(2, 30, { getURL: () => { throw new Error('Frame detached'); } });
  expect(projectDesktopResources([metric(20)], [guest, unknown], isRendererSender).processes[0].canTerminate).toBe(false);
  expect(terminateResourceProcess([metric(20)], [guest, unknown], isRendererSender, target)).toBe('protected');
  expect(guest.forcefullyCrashRenderer).not.toHaveBeenCalled();
  expect(host.forcefullyCrashRenderer).not.toHaveBeenCalled();
  expect(extension.forcefullyCrashRenderer).not.toHaveBeenCalled();
});

it('rejects malformed process identities before a native action', () => {
  const guest = page(1, 20);
  for (const target of [null, { pid: '20', startedAt: 100, pageIds: [1] },
    { pid: 20, startedAt: 100, pageIds: [] }, { pid: 20, startedAt: 100, pageIds: [1, 1] }]) {
    expect(() => terminateResourceProcess([metric(20)], [guest], isRendererSender, target)).toThrow('Invalid resource process target');
  }
  expect(guest.forcefullyCrashRenderer).not.toHaveBeenCalled();
});
