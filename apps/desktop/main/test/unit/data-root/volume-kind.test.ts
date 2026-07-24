import { describe, expect, it } from 'vitest';
import {
  isPathOnNetworkMount,
  parseDarwinMounts,
  parseLinuxMountInfo,
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

  it('uses the longest Linux mount and recognizes NFS and CIFS volumes', () => {
    const mounts = parseLinuxMountInfo([
      '21 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw',
      '22 21 0:42 / /mnt/team rw,relatime - nfs4 server:/team rw',
      '23 21 0:43 / /mnt/team/local rw,relatime - ext4 /dev/sdb1 rw',
      '24 21 0:44 / /mnt/share rw,relatime - cifs //server/share rw',
    ].join('\n'));

    expect(isPathOnNetworkMount('/mnt/team/project', mounts)).toBe(true);
    expect(isPathOnNetworkMount('/mnt/share/data', mounts)).toBe(true);
    expect(isPathOnNetworkMount('/mnt/team/local/data', mounts)).toBe(false);
  });
});
