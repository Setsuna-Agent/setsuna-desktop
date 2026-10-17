import path from 'node:path';
import { WindowsNativeSandboxService } from '@setsuna-desktop/feature-windows-sandbox/runtime';
import type { ShellSandboxProvider } from '../../src/ports/shell-sandbox-provider.js';

/** Use the packaged helper in real Windows shell tests, without installing sandbox accounts. */
export function configureWindowsShellLauncher(): void {
  if (process.platform === 'win32') {
    process.env.SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH ??= path.resolve('.cache/windows-sandbox/win-x64/setsuna-sandbox-win.exe');
  }
}

export function windowsShellProvider(): ShellSandboxProvider | undefined {
  if (process.platform !== 'win32') return undefined;
  configureWindowsShellLauncher();
  const service = new WindowsNativeSandboxService();
  return {
    managedCommand: (command) => service.managedCommand(command),
    capability: () => ({ supported: false, provider: '', reason: 'Sandbox accounts are not installed by this fixture.' }),
    controlRoot: () => service.controlRoot(),
    networkEnvironment: async () => ({}),
    prepareEnvironment: (environment) => ({ environment, readableRoots: [] }),
    writeRequest: async () => { throw new Error('This fixture only launches host commands.'); },
  };
}
