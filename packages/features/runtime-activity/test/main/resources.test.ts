import { provideHostCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainFeatureHost } from '@setsuna-desktop/feature-core/main';
import { app, ipcMain, webContents, type IpcMainInvokeEvent, type ProcessMetric, type WebContents, type WebFrameMain } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { runtimeActivityMainFeature, runtimeActivityMainHostCapability } from '../../src/main/feature.js';
import { projectDesktopResources } from '../../src/main/resources.js';
import { RUNTIME_ACTIVITY_RESOURCE_CHANNEL, RUNTIME_ACTIVITY_TERMINATE_RESOURCE_CHANNEL } from '../../src/contracts/index.js';

vi.mock('electron', () => ({
  app: { getAppMetrics: vi.fn(() => []) },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  webContents: { getAllWebContents: vi.fn(() => []) },
}));
afterEach(() => vi.clearAllMocks());

it('registers without sampling at startup and checks desktop/frame ownership before querying native processes', async () => {
  const started = performance.now();
  const baseline = await defineMainFeatureHost({ required: [], optional: [] }).activate();
  const baselineMs = performance.now() - started;
  await baseline.dispose();
  const featureStarted = performance.now();
  const composition = await defineMainFeatureHost({ required: [], optional: [runtimeActivityMainFeature] }).activate({
    hostCapabilities: [provideHostCapability(runtimeActivityMainHostCapability, { isRendererSender: (id: number) => id === 1 })],
  });
  const activationMs = performance.now() - featureStarted;
  expect(app.getAppMetrics).not.toHaveBeenCalled();
  expect(webContents.getAllWebContents).not.toHaveBeenCalled();
  const handlers = new Map(vi.mocked(ipcMain.handle).mock.calls);
  const handler = handlers.get(RUNTIME_ACTIVITY_RESOURCE_CHANNEL)!;
  const frame = {};
  const invoke = (id: number, senderFrame = frame) => handler({ sender: { id, mainFrame: frame }, senderFrame } as IpcMainInvokeEvent);
  await expect(invoke(2)).rejects.toThrow('desktop renderer');
  await expect(invoke(1, {})).rejects.toThrow('desktop renderer');
  expect(app.getAppMetrics).not.toHaveBeenCalled();
  await expect(invoke(1)).resolves.toMatchObject({ processes: [] });
  expect(app.getAppMetrics).toHaveBeenCalledOnce();
  const terminate = handlers.get(RUNTIME_ACTIVITY_TERMINATE_RESOURCE_CHANNEL)!;
  await expect(terminate({ sender: { id: 2, mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent, {})).rejects.toThrow('desktop renderer');
  await expect(terminate({ sender: { id: 1, mainFrame: frame }, senderFrame: {} } as IpcMainInvokeEvent, {})).rejects.toThrow('desktop renderer');
  expect(app.getAppMetrics).toHaveBeenCalledOnce();
  await composition.dispose();
  expect(ipcMain.removeHandler).toHaveBeenCalledTimes(2);
  process.stdout.write(`resource main activation: baseline ${baselineMs.toFixed(2)} ms; feature ${activationMs.toFixed(2)} ms; startup native queries: 0\n`);
});

it('associates shared pages and out-of-process frames without attributing embedded guests to the host', () => {
  const metrics = [1, 2, 3].map(pid => ({ pid, creationTime: 1, type: 'Tab',
    cpu: { cumulativeCPUUsage: 2, percentCPUUsage: 3 }, memory: { workingSetSize: 1024 } })) as ProcessMetric[];
  const page = (id: number, pids: number[], type = 'webview') => {
    const mainFrame = { osProcessId: pids[0], isDestroyed: () => false } as WebFrameMain;
    Object.assign(mainFrame, { top: mainFrame,
      framesInSubtree: [mainFrame, ...pids.slice(1).map(osProcessId => ({ osProcessId, top: mainFrame, isDestroyed: () => false }))] });
    return { id, isDestroyed: () => false, isCrashed: () => false, getOSProcessId: () => pids[0], getTitle: () => `Page ${id}`,
      getURL: () => 'https://example.test', getType: () => type,
      hostWebContents: { id: 9, isDestroyed: () => false }, mainFrame } as WebContents;
  };
  const first = page(1, [1, 2, 2]);
  const second = page(2, [1]);
  const host = page(9, [3], 'window');
  host.mainFrame.framesInSubtree.push(...first.mainFrame.framesInSubtree, ...second.mainFrame.framesInSubtree);
  const snapshot = projectDesktopResources(metrics, [host, first, second,
    { isDestroyed: () => true } as WebContents], id => id === 9);
  expect(snapshot.processes.map(item => item.pages.map(page => page.id))).toEqual([[1, 2], [1], [9]]);
  expect(snapshot.processes.reduce((bytes, item) => bytes + item.residentBytes, 0)).toBe(3 * 1024 * 1024);
  expect(snapshot.processes.map(item => item.canTerminate)).toEqual([true, false, false]);
});
