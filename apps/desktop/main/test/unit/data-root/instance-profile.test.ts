import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPUTER_USE_LAB_APP_NAME, resolveDesktopInstanceProfile } from '../../../src/data-root/instance-profile.js';

describe('desktop instance profile', () => {
  it('isolates the signed computer-use lab even when a release data root is provided', () => {
    const appDataRoot = path.join(path.parse(process.cwd()).root, 'system-app-data');
    const defaultDataRoot = path.join(appDataRoot, 'Setsuna Desktop');
    const profile = resolveDesktopInstanceProfile({ appDataRoot, defaultDataRoot, isPackaged: true, appName: COMPUTER_USE_LAB_APP_NAME });
    expect(profile.appDataRoot).toBe(path.join(appDataRoot, COMPUTER_USE_LAB_APP_NAME));
    expect(profile.defaultDataRoot).toBe(path.join(profile.appDataRoot, 'Data'));
    expect(profile.defaultDataRoot).not.toBe(defaultDataRoot);
    expect(resolveDesktopInstanceProfile({ appDataRoot, defaultDataRoot, isPackaged: true, appName: 'Setsuna Desktop' }))
      .toEqual({ appDataRoot, defaultDataRoot });
  });
  it('preserves Electron paths for packaged builds', () => {
    const appDataRoot = path.join(path.parse(process.cwd()).root, 'system-app-data');
    const defaultDataRoot = path.join(appDataRoot, 'Setsuna Desktop');

    expect(resolveDesktopInstanceProfile({
      appDataRoot,
      defaultDataRoot,
      isPackaged: true,
    })).toEqual({
      appDataRoot: path.resolve(appDataRoot),
      defaultDataRoot: path.resolve(defaultDataRoot),
    });
  });

  it('uses isolated bootstrap and data roots for unpackaged development', () => {
    const appDataRoot = path.join(path.parse(process.cwd()).root, 'system-app-data');
    const packagedDataRoot = path.join(appDataRoot, 'Setsuna Desktop');
    const profile = resolveDesktopInstanceProfile({
      appDataRoot,
      defaultDataRoot: packagedDataRoot,
      isPackaged: false,
    });

    expect(profile).toEqual({
      appDataRoot: path.join(appDataRoot, 'Setsuna Desktop Development'),
      defaultDataRoot: path.join(appDataRoot, 'Setsuna Desktop Development', 'Data'),
    });
    expect(profile.appDataRoot).not.toBe(path.resolve(appDataRoot));
    expect(profile.defaultDataRoot).not.toBe(path.resolve(packagedDataRoot));
  });
});
