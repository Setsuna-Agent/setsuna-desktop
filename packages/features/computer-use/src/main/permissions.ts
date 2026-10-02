import { desktopCapturer, shell, systemPreferences } from 'electron';
import type { ComputerPermission, ComputerPermissions } from '../contracts/index.js';

const settingsUrls: Record<ComputerPermission, string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
};

export function computerPermissions(): ComputerPermissions {
  if (process.platform === 'win32') return { screen: 'not-required', accessibility: 'not-required' };
  if (process.platform !== 'darwin') return { screen: 'unsupported', accessibility: 'unsupported' };
  return {
    screen: systemPreferences.getMediaAccessStatus('screen'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
  };
}

/** Only the settings button invokes this; status checks and model tools never prompt. */
export async function requestComputerPermission(permission: ComputerPermission): Promise<void> {
  if (permission !== 'screen' && permission !== 'accessibility') throw new Error('Invalid desktop permission.');
  if (process.platform !== 'darwin') return;
  const status = computerPermissions()[permission];
  if (status === 'granted') return;

  if (permission === 'accessibility') {
    systemPreferences.isTrustedAccessibilityClient(true);
  } else if (status !== 'restricted') {
    // Electron has no askForMediaAccess('screen'). A minimal, discarded capture
    // asks macOS for consent and registers the app in Screen Recording settings.
    try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 }, fetchWindowIcons: false }); }
    catch { /* Denial still needs a working route to the corresponding settings pane. */ }
  }

  // macOS may suppress a repeated prompt; always provide a route to enable access.
  if (computerPermissions()[permission] !== 'granted') await shell.openExternal(settingsUrls[permission]);
}
