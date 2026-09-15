import { FileIcon, FileTreeRow, FileTreeSurface } from '@setsuna-desktop/renderer-ui';
import { useMemo, useState } from 'react';
import type { PullRequestFile } from '../contracts/index.js';

type TreeNode = { path: string; name: string; file?: PullRequestFile; children: Map<string, TreeNode> };
function fileTree(files: PullRequestFile[]) {
  const root: TreeNode = { path: '', name: '', children: new Map() };
  for (const file of files) {
    let parent = root;
    const parts = file.path.split('/');
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/');
      const leaf = index === parts.length - 1;
      // Base and head can contain a file and a directory at the same path.
      const key = `${leaf ? 'file' : 'directory'}:${name}`;
      let node = parent.children.get(key);
      if (!node) { node = { path, name, children: new Map() }; parent.children.set(key, node); }
      if (leaf) node.file = file;
      parent = node;
    });
  }
  return root;
}
export function PullRequestFileTree({ files, path, onSelect }: { files: PullRequestFile[]; path: string | null; onSelect(path: string): void }) {
  const tree = useMemo(() => fileTree(files), [files]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (path: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  return <FileTreeSurface><TreeChildren parent={tree} depth={0} path={path} collapsed={collapsed} toggle={toggle} onSelect={onSelect} /></FileTreeSurface>;
}
function TreeChildren({ parent, depth, path, collapsed, toggle, onSelect }: {
  parent: TreeNode; depth: number; path: string | null; collapsed: ReadonlySet<string>; toggle(path: string): void; onSelect(path: string): void;
}) {
  const nodes = [...parent.children.values()].sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name));
  return <>{nodes.map((entry) => {
    let node = entry;
    let label = node.name;
    // Compact single-directory chains so deep paths leave room for file names.
    while (!node.file && node.children.size === 1) {
      const child = node.children.values().next().value!;
      if (child.file) break;
      node = child;
      label += `/${node.name}`;
    }
    return <div key={`${node.file ? 'file' : 'directory'}:${node.path}`}>
      <FileTreeRow depth={depth} label={label} title={node.path} expanded={node.file ? undefined : !collapsed.has(node.path)} selected={Boolean(node.file) && path === node.path} icon={node.file ? <FileIcon path={node.path} /> : undefined} onClick={() => node.file ? onSelect(node.path) : toggle(node.path)} />
      {!node.file && !collapsed.has(node.path) ? <TreeChildren parent={node} depth={depth + 1} path={path} collapsed={collapsed} toggle={toggle} onSelect={onSelect} /> : null}
    </div>;
  })}</>;
}
