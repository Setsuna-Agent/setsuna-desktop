import type { DesktopGitChangedFile, DesktopGitCommit, DesktopGitRef } from '../contracts/index.js';

export const GIT_HISTORY_FORMAT = '%H%x00%P%x00%an%x00%aI%x00%s%x00';

export function parseGitHistory(output: string): DesktopGitCommit[] {
  const fields = output.split('\0');
  const commits: DesktopGitCommit[] = [];
  for (let index = 0; index + 4 < fields.length; index += 5) {
    const oid = fields[index].trim();
    if (!oid) continue;
    commits.push({
      oid,
      parents: fields[index + 1].split(' ').filter(Boolean),
      author: fields[index + 2],
      authoredAt: fields[index + 3],
      subject: fields[index + 4],
    });
  }
  return commits;
}

export function parseGitRefs(output: string): DesktopGitRef[] {
  return output.split(/\r?\n/u).flatMap((line): DesktopGitRef[] => {
    const [name, object, peeled, type, peeledType, symbolic] = line.split('\0');
    if (!name || symbolic || (peeled ? peeledType : type) !== 'commit') return [];
    const kind = name.startsWith('refs/heads/') ? 'local' : name.startsWith('refs/remotes/') ? 'remote' : 'tag';
    const prefix = kind === 'local' ? 'refs/heads/' : kind === 'remote' ? 'refs/remotes/' : 'refs/tags/';
    return [{ name, label: name.slice(prefix.length), kind, oid: peeled || object }];
  });
}

/** Both outputs use -z, so tabs, quotes and newlines in filenames remain unambiguous. */
export function parseGitChangedFiles(statusOutput: string, statsOutput: string): DesktopGitChangedFile[] {
  const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  const statsFields = statsOutput.split('\0');
  for (let index = 0; index < statsFields.length; index += 1) {
    const record = statsFields[index];
    if (!record) continue;
    const firstTab = record.indexOf('\t');
    const secondTab = record.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const added = record.slice(0, firstTab);
    const removed = record.slice(firstTab + 1, secondTab);
    let filePath = record.slice(secondTab + 1);
    if (!filePath) {
      // Renames encode the old and new paths as two additional NUL fields.
      filePath = statsFields[index + 2];
      index += 2;
    }
    if (filePath) stats.set(filePath, { additions: Number(added) || 0, deletions: Number(removed) || 0, binary: added === '-' });
  }
  const fields = statusOutput.split('\0');
  const files: DesktopGitChangedFile[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index];
    if (!status) continue;
    const renamed = status.startsWith('R') || status.startsWith('C');
    const previousPath = renamed ? fields[index + 1] : undefined;
    const filePath = fields[index + (renamed ? 2 : 1)];
    if (renamed) index += 1;
    if (!filePath) continue;
    const counts = stats.get(filePath);
    files.push({
      path: filePath,
      ...(previousPath ? { previousPath } : {}),
      action: renamed ? 'Renamed' : status === 'A' ? 'Created' : status === 'D' ? 'Deleted' : 'Modified',
      additions: counts?.additions ?? 0,
      deletions: counts?.deletions ?? 0,
      ...(counts?.binary ? { contentKind: 'binary' as const } : {}),
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
