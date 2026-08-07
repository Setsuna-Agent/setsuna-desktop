import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDesktopInstanceProfile } from '../../../src/data-root/instance-profile.js';

describe('desktop instance profile', () => {
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
