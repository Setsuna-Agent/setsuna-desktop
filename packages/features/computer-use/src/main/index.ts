export { computerMainFeature, computerMainHostCapability, computerConnectionCapability, computerMainLifecycleCapability, type ComputerMainLifecycle } from './feature.js';

import { app, systemPreferences } from 'electron';
import { HelperComputerDriver } from './helper-driver.js';
import { ComputerProcess, windowHelperPath } from './computer-process.js';

/** Explicit CLI diagnostic: no session, screenshot, input, network or permission request. */
export async function diagnoseComputerUse(): Promise<unknown> {
  await app.whenReady();
  const mainPermissions = process.platform === 'darwin' ? {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screenRecording: systemPreferences.getMediaAccessStatus('screen'),
  } : null;
  let driver: unknown;
  if (process.platform === 'darwin') {
    const helper = new ComputerProcess(windowHelperPath(app.getAppPath(), app.isPackaged), () => undefined);
    try { driver = await helper.request({ kind: 'probe' }, AbortSignal.timeout(15_000)); }
    finally { await helper.stop(); }
  } else { driver = await new HelperComputerDriver().probe(); }
  return { appName: app.getName(), appPath: app.getAppPath(), executable: process.execPath, userData: app.getPath('userData'), pid: process.pid, parentPid: process.ppid, sampledAt: new Date().toISOString(), packaged: app.isPackaged, platform: process.platform, arch: process.arch, appActive: process.platform === 'darwin' ? app.isActive() : null, mainPermissions, driver };
}
