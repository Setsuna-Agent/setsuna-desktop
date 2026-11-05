type FilePath = { path: string };
type DirectoryNode<File extends FilePath> = {
  children: ReviewFileTreeNode<File>[];
  name: string;
  path: string;
  type: 'directory';
};
export type ReviewFileTreeNode<File extends FilePath> = DirectoryNode<File> | {
  file: File;
  name: string;
  path: string;
  type: 'file';
};

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Keep original file objects so selection retains the active Git version. */
export function buildReviewFileTree<File extends FilePath>(files: readonly File[], compact = true): ReviewFileTreeNode<File>[] {
  const root: DirectoryNode<File> = { children: [], name: '', path: '', type: 'directory' };
  for (const file of files) {
    const parts = file.path.split(/[\\/]+/u).filter(Boolean);
    let parent = root;
    let path = '';
    parts.forEach((name, index) => {
      path = path ? `${path}/${name}` : name;
      if (index === parts.length - 1) {
        parent.children.push({ file, name, path, type: 'file' });
        return;
      }
      let directory = parent.children.find((node): node is DirectoryNode<File> => (
        node.type === 'directory' && node.path === path
      ));
      if (!directory) {
        directory = { children: [], name, path, type: 'directory' };
        parent.children.push(directory);
      }
      parent = directory;
    });
  }
  sortDirectory(root);
  return compact ? root.children.map(compactDirectory) : root.children;
}

function compactDirectory<File extends FilePath>(node: ReviewFileTreeNode<File>): ReviewFileTreeNode<File> {
  if (node.type === 'file') return node;
  const names = [node.name];
  let directory = node;
  while (directory.children.length === 1 && directory.children[0]?.type === 'directory') {
    directory = directory.children[0];
    names.push(directory.name);
  }
  // The final directory owns folding; original file paths remain unchanged.
  return { ...directory, name: names.join('/'), children: directory.children.map(compactDirectory) };
}

function sortDirectory<File extends FilePath>(directory: DirectoryNode<File>): void {
  directory.children.sort((left, right) => left.type !== right.type
    ? left.type === 'directory' ? -1 : 1
    : collator.compare(left.name, right.name));
  directory.children.forEach((node) => { if (node.type === 'directory') sortDirectory(node); });
}
