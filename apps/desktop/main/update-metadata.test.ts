import { describe, expect, it } from 'vitest';
import { checksumForAsset, compareVersions, isNewerVersion, parseSha256Sums, selectUpdateAsset, type ReleaseAsset } from './update-metadata.js';

const assets: ReleaseAsset[] = [
  { name: 'Setsuna-Desktop-0.2.0-mac-arm64.zip', browser_download_url: 'https://example.com/mac-arm64.zip' },
  { name: 'Setsuna-Desktop-0.2.0-mac-arm64.dmg', browser_download_url: 'https://example.com/mac-arm64.dmg' },
  { name: 'Setsuna-Desktop-0.2.0-mac-x64.dmg', browser_download_url: 'https://example.com/mac-x64.dmg' },
  { name: 'Setsuna-Desktop-0.2.0-windows-x64.exe', browser_download_url: 'https://example.com/windows.exe' },
  { name: 'Setsuna-Desktop-0.2.0-ubuntu-x64.AppImage', browser_download_url: 'https://example.com/linux.AppImage' },
];

describe('desktop update metadata', () => {
  it('compares release tag versions against the packaged app version', () => {
    expect(compareVersions('v0.2.0', '0.1.9')).toBe(1);
    expect(compareVersions('0.1.0', 'v0.1.0')).toBe(0);
    expect(isNewerVersion('v0.2.0', '0.1.9')).toBe(true);
    expect(isNewerVersion('v0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('v0.1.4-fix.1', '0.1.4')).toBe(true);
  });

  it('selects the preferred installer for the current platform and architecture', () => {
    expect(selectUpdateAsset(assets, 'darwin', 'arm64')?.name).toBe('Setsuna-Desktop-0.2.0-mac-arm64.dmg');
    expect(selectUpdateAsset(assets, 'darwin', 'x64')?.name).toBe('Setsuna-Desktop-0.2.0-mac-x64.dmg');
    expect(selectUpdateAsset(assets, 'win32', 'x64')?.name).toBe('Setsuna-Desktop-0.2.0-windows-x64.exe');
    expect(selectUpdateAsset(assets, 'linux', 'x64')?.name).toBe('Setsuna-Desktop-0.2.0-ubuntu-x64.AppImage');
  });

  it('parses SHA256SUMS entries for release asset verification', () => {
    const checksums = parseSha256Sums(''.padStart(64, 'a') + '  Setsuna-Desktop-0.2.0-mac-arm64.dmg\n');

    expect(checksumForAsset(checksums, 'Setsuna-Desktop-0.2.0-mac-arm64.dmg')).toBe(''.padStart(64, 'a'));
    expect(checksumForAsset(checksums, 'missing.dmg')).toBeNull();
  });
});
