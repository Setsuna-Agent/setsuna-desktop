import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const NETWORK_FILE_SYSTEMS = new Set([
  '9p',
  'afpfs',
  'cifs',
  'davfs',
  'fuse.sshfs',
  'ncpfs',
  'nfs',
  'nfs4',
  'smb3',
  'smbfs',
  'sshfs',
  'webdav',
]);

export type MountedVolume = {
  mountPoint: string;
  fileSystem: string;
};

export async function isNetworkVolumePath(
  target: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (isUncPath(target)) return true;
  try {
    if (platform === 'darwin') {
      const { stdout } = await execFileAsync('/sbin/mount', [], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      return isPathOnNetworkMount(target, parseDarwinMounts(stdout));
    }
    if (platform === 'linux') {
      const mountInfo = await readFile('/proc/self/mountinfo', 'utf8');
      return isPathOnNetworkMount(target, parseLinuxMountInfo(mountInfo));
    }
    if (platform === 'win32') return windowsDriveIsNetwork(target);
  } catch {
    // Detection is advisory. Failure must not turn a valid local target into a blocker.
  }
  return false;
}

export function parseDarwinMounts(output: string): MountedVolume[] {
  const mounts: MountedVolume[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /^.+ on (.+) \(([^,)]+)(?:,|\))/u.exec(line.trim());
    if (!match) continue;
    mounts.push({
      mountPoint: unescapeMountPath(match[1]),
      fileSystem: match[2].trim().toLowerCase(),
    });
  }
  return mounts;
}

export function parseLinuxMountInfo(output: string): MountedVolume[] {
  const mounts: MountedVolume[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const [metadata, fileSystemData] = line.split(' - ', 2);
    if (!metadata || !fileSystemData) continue;
    const metadataFields = metadata.split(' ');
    const fileSystemFields = fileSystemData.split(' ');
    if (!metadataFields[4] || !fileSystemFields[0]) continue;
    mounts.push({
      mountPoint: unescapeMountPath(metadataFields[4]),
      fileSystem: fileSystemFields[0].trim().toLowerCase(),
    });
  }
  return mounts;
}

export function isPathOnNetworkMount(
  target: string,
  mounts: readonly MountedVolume[],
): boolean {
  const resolvedTarget = path.resolve(target);
  const mount = [...mounts]
    .filter((candidate) => pathContains(candidate.mountPoint, resolvedTarget))
    .sort((left, right) => right.mountPoint.length - left.mountPoint.length)[0];
  if (!mount) return false;
  const fileSystem = mount.fileSystem.toLowerCase();
  return NETWORK_FILE_SYSTEMS.has(fileSystem)
    || fileSystem.startsWith('fuse.sshfs')
    || fileSystem.startsWith('fuse.rclone')
    || fileSystem.startsWith('fuse.goofys');
}

async function windowsDriveIsNetwork(target: string): Promise<boolean> {
  const parsed = path.win32.parse(path.win32.resolve(target));
  const drive = parsed.root.slice(0, 2).toUpperCase();
  if (!/^[A-Z]:$/u.test(drive)) return false;
  const command = [
    `$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'"`,
    'if ($null -ne $disk) { [Console]::Out.Write($disk.DriveType) }',
  ].join('; ');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ], {
    encoding: 'utf8',
    timeout: 3_000,
    windowsHide: true,
  });
  return stdout.trim() === '4';
}

function isUncPath(target: string): boolean {
  return target.startsWith('\\\\') || target.startsWith('//');
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function unescapeMountPath(value: string): string {
  return value
    .replaceAll('\\040', ' ')
    .replaceAll('\\011', '\t')
    .replaceAll('\\012', '\n')
    .replaceAll('\\134', '\\');
}
