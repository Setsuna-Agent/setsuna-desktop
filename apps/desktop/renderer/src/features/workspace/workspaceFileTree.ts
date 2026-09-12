import type { WorkspaceEntry, WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import type { ProjectTreeNode } from './model.js';
import { normalizeProjectTreePath } from './workspaceEntryPaths.js';
export { normalizeProjectTreePath } from './workspaceEntryPaths.js';

export const FILE_TREE_MIN_WIDTH = 190;
export const FILE_TREE_MAX_WIDTH = 360;

export function clampFileTreeWidth(value: number): number {
  return Math.min(FILE_TREE_MAX_WIDTH, Math.max(FILE_TREE_MIN_WIDTH, Math.round(value)));
}

export function searchItemToWorkspaceEntry(item: WorkspaceEntrySearchItem): WorkspaceEntry {
  return {
    name: item.name,
    path: item.path,
    type: item.kind,
  };
}

export function mergeProjectEntries(current: WorkspaceEntry[], incoming: WorkspaceEntry[]): WorkspaceEntry[] {
  const byPath = new Map(current.map((entry) => [entry.path, entry]));
  incoming.forEach((entry) => byPath.set(entry.path, entry));
  return [...byPath.values()].sort(compareWorkspaceEntry);
}

/** A directory listing replaces its children; keep cached descendants only under surviving folders. */
export function replaceDirectoryEntries(current: WorkspaceEntry[], directoryPath: string, incoming: WorkspaceEntry[]): WorkspaceEntry[] {
  const prefix = directoryPath ? `${directoryPath}/` : '';
  const directories = new Set(incoming.filter((entry) => entry.type === 'directory').map((entry) => entry.path));
  const retained = current.filter((entry) => {
    if (!entry.path.startsWith(prefix)) return true;
    const childPath = prefix + entry.path.slice(prefix.length).split('/')[0];
    return entry.path !== childPath && directories.has(childPath);
  });
  return mergeProjectEntries(retained, incoming);
}

function compareWorkspaceEntry(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
  return left.name.localeCompare(right.name);
}

export function buildProjectEntryTree(entries: WorkspaceEntry[]): ProjectTreeNode[] {
  const root: ProjectTreeNode = {
    children: [],
    entry: { name: '', path: '', type: 'directory' },
    name: '',
    path: '',
    type: 'directory',
  };
  [...entries].sort(compareWorkspaceEntry).forEach((entry) => {
    const parts = normalizeProjectTreePath(entry.path).split('/').filter(Boolean);
    let parent = root;
    let currentPath = '';
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const last = index === parts.length - 1;
      const type = last ? entry.type : 'directory';
      let node = parent.children.find((item) => item.path === currentPath);
      if (!node) {
        node = {
          children: [],
          entry: last ? entry : { name: part, path: currentPath, type: 'directory' },
          name: last ? entry.name : part,
          path: currentPath,
          type,
        };
        parent.children.push(node);
      } else if (last) {
        node.entry = entry;
        node.name = entry.name;
        node.type = entry.type;
      }
      if (node.type === 'directory') parent = node;
    });
  });

  const sortNode = (node: ProjectTreeNode) => {
    node.children.sort((left, right) => compareWorkspaceEntry(left.entry, right.entry));
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root.children;
}
