import { describe, expect, it } from 'vitest';
import {
  isNetworkVolumePath,
  isPathOnNetworkMount,
  parseDarwinMounts,
} from '../../../src/data-root/volume-kind.js';

describe('data root volume detection', () => {
  it('recognizes a macOS SMB mount even when its path has no cloud keyword', () => {
    const mounts = parseDarwinMounts([
      '/dev/disk3s1 on / (apfs, local, journaled)',
      '//user@nas.local/setsuna on /Volumes/NAS (smbfs, nodev, nosuid, mounted by user)',
    ].join('\n'));

    expect(isPathOnNetworkMount('/Volumes/NAS/Setsuna Data', mounts)).toBe(true);
    expect(isPathOnNetworkMount('/Users/user/Setsuna Data', mounts)).toBe(false);
  });

  it('uses the longest mount when a local volume is nested under a network share', () => {
    const mounts = parseDarwinMounts([
      'server:/team on /Volumes/Team (nfs, nodev, nosuid)',
      '/dev/disk4s1 on /Volumes/Team/Local (apfs, local, journaled)',
    ].join('\n'));

    expect(isPathOnNetworkMount('/Volumes/Team/project', mounts)).toBe(true);
    expect(isPathOnNetworkMount('/Volumes/Team/Local/data', mounts)).toBe(false);
  });

  it('treats a failed Windows drive probe as advisory', async () => {
    const windowsDriveDetector = async (): Promise<boolean> => {
      throw new Error('PowerShell is unavailable');
    };

    await expect(isNetworkVolumePath('C:\\Setsuna Data', 'win32', {
      windowsDriveDetector,
    })).resolves.toBe(false);
  });
});
