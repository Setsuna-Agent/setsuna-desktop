import path from 'node:path';

/** Returns each directory from the workspace root through the selected cwd. */
export function directoriesFromRoot(root: string, cwd: string): string[] {
  const relative = path.relative(root, cwd);
  const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
  return [root, ...parts.map((_part, index) => path.join(root, ...parts.slice(0, index + 1)))];
}

export function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Truncates prompt-bound text without exceeding its UTF-8 byte budget. */
export function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let start = 0;
  let end = value.length;
  while (start < end) {
    const middle = Math.ceil((start + end) / 2);
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maxBytes) start = middle;
    else end = middle - 1;
  }
  return value.slice(0, start).trimEnd();
}
