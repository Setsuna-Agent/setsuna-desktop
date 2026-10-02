import { defineCapability, declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { app, ipcMain, powerMonitor, screen } from 'electron';
import path from 'node:path';
import { computerUseFeature, computerUseChannels, type ComputerConnection, type ComputerPermission } from '../contracts/index.js';
import { ComputerControlServer } from './control-server.js';
import { HelperComputerDriver } from './helper-driver.js';
import { ComputerSessionController, isUserComputerStop } from './session-controller.js';
import { NativeComputerSupervisor } from './supervisor.js';
import { ElectronComputerCapture } from './electron-capture.js';
import { ComputerDiagnosticJournal } from './diagnostics.js';
import { ComputerSettingsService } from './settings.js';
import { computerPermissions, requestComputerPermission } from './permissions.js';
import { DesktopComputerBackend } from './backend.js';
import { MacWindowBackend } from './window-backend.js';
import { ComputerProcess, windowHelperPath } from './computer-process.js';

export const computerMainHostCapability = defineCapability<{
  isAllowedSender(senderId: number): boolean;
  interfaceLanguage(): RuntimeInterfaceLanguage;
  writeJsonAtomically(filePath: string, value: unknown): Promise<void>;
  cancelTurn(threadId: string, turnId: string): Promise<void>;
}>({ id: 'computer-use.main-host', description: 'Trusted desktop window identity' });
export const computerConnectionCapability = defineCapability<ComputerConnection>({ id: 'computer-use.connection', description: 'Independent desktop loopback connection' });
export type ComputerMainLifecycle = { runtimeExited(): Promise<void> };
export const computerMainLifecycleCapability = defineCapability<ComputerMainLifecycle>({ id: 'computer-use.main-lifecycle', description: 'Main-owned runtime exit cleanup' });
export const computerMainFeature = defineMainFeature({
  definition: computerUseFeature,
  dependencies: defineMainDependencies({ host: requiredCapability(computerMainHostCapability) }),
  provides: [declareCapabilityProvider(computerConnectionCapability), declareCapabilityProvider(computerMainLifecycleCapability)],
  async setup(context) {
    const host = context.dependencies.host;
    const journal = new ComputerDiagnosticJournal(path.join(app.getPath('userData'), 'logs', 'computer-use.jsonl'));
    const supervisor = new NativeComputerSupervisor(host.interfaceLanguage);
    const onExit = () => { void control.stop('helper-exited').catch(() => undefined); };
    const windowsDriver = process.platform === 'win32' ? new HelperComputerDriver(onExit) : undefined;
    const backend = process.platform === 'darwin'
      ? new MacWindowBackend(new ComputerProcess(windowHelperPath(app.getAppPath(), app.isPackaged), onExit))
      : new DesktopComputerBackend(windowsDriver!, new ElectronComputerCapture(), () => supervisor.display());
    const control = new ComputerSessionController(backend, supervisor, Date.now, (reason, identity) => {
      console.info('[computer-use] session stopped', { reason, at: new Date().toISOString() });
      if (isUserComputerStop(reason)) return host.cancelTurn(identity.threadId, identity.turnId);
    }, (event) => journal.record(event));
    const settings = new ComputerSettingsService(path.join(app.getPath('userData'), 'computer-use.json'), control, host.writeJsonAtomically, computerPermissions, windowsDriver);
    await settings.load();
    const server = new ComputerControlServer(settings);
    const stop = (reason: string) => { void control.stop(reason).catch(() => undefined); };
    const locked = () => stop('screen-locked');
    const suspended = () => stop('system-suspended');
    const added = () => stop('display-added');
    const removed = () => stop('display-removed');
    const metricsChanged = (_event: unknown, _display: unknown, metrics: string[]) => stop(`display-metrics:${metrics.join(',')}`);
    ipcMain.handle(computerUseChannels.status, (event) => {
      if (!host.isAllowedSender(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('Unauthorized desktop status sender.');
      return control.status();
    });
    ipcMain.handle(computerUseChannels.stop, (event) => {
      if (!host.isAllowedSender(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('Unauthorized desktop stop sender.');
      return control.stop('user-stop');
    });
    ipcMain.handle(computerUseChannels.preview, (event) => {
      if (!host.isAllowedSender(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('Unauthorized desktop preview sender.');
      return control.preview();
    });
    ipcMain.handle(computerUseChannels.settings, (event) => {
      if (!host.isAllowedSender(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('Unauthorized desktop settings sender.');
      return settings.settings();
    });
    ipcMain.handle(computerUseChannels.setEnabled, (event, enabled: boolean) => {
      if (!host.isAllowedSender(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('Unauthorized desktop settings sender.');
      return settings.setEnabled(enabled);
    });
    ipcMain.handle(computerUseChannels.requestPermission, (event, permission: ComputerPermission) => {
      if (!host.isAllowedSender(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('Unauthorized desktop permission sender.');
      if (permission === 'administrator') return settings.requestAdministratorAccess();
      return requestComputerPermission(permission);
    });
    powerMonitor.on('lock-screen', locked);
    powerMonitor.on('suspend', suspended);
    screen.on('display-added', added);
    screen.on('display-removed', removed);
    screen.on('display-metrics-changed', metricsChanged);
    context.scope.add(async () => {
      ipcMain.removeHandler(computerUseChannels.status); ipcMain.removeHandler(computerUseChannels.stop);
      ipcMain.removeHandler(computerUseChannels.preview);
      ipcMain.removeHandler(computerUseChannels.settings); ipcMain.removeHandler(computerUseChannels.setEnabled);
      ipcMain.removeHandler(computerUseChannels.requestPermission);
      powerMonitor.off('lock-screen', locked); powerMonitor.off('suspend', suspended);
      screen.off('display-added', added); screen.off('display-removed', removed); screen.off('display-metrics-changed', metricsChanged);
      try { await control.stop('feature-disposed'); }
      finally { await server.stop(); await settings.flush(); await journal.flush(); }
    });
    context.provide(declareCapabilityProvider(computerConnectionCapability), await server.start());
    context.provide(declareCapabilityProvider(computerMainLifecycleCapability), { runtimeExited: () => control.stop('runtime-exited') });
  },
});
