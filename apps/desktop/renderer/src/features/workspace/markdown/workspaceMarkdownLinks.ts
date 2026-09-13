type MarkdownTarget = { kind: 'external'; href: string } | { kind: 'anchor'; id: string }
  | { kind: 'file'; path: string; line?: number } | { kind: 'unavailable' };

/** Resolve document-relative paths before handing them to the workspace-scoped runtime API. */
export function resolveWorkspaceMarkdownTarget(value: string | undefined, filePath: string): MarkdownTarget {
  if (!value) return { kind: 'unavailable' };
  if (/^(https?:|mailto:)/i.test(value)) return { kind: 'external', href: value };
  if (value.startsWith('//')) return { kind: 'external', href: `https:${value}` };
  if (/^[a-z][\w+.-]*:/i.test(value)) return { kind: 'unavailable' };
  try {
    if (value.startsWith('#')) return { kind: 'anchor', id: decodeURIComponent(value.slice(1)) };
    const path = decodeURIComponent(value.split(/[?#]/, 1)[0]).replace(/\\/g, '/');
    if (!path || path.includes('\0') || /^[a-z][\w+.-]*:/i.test(path) || path.startsWith('//')) {
      return { kind: 'unavailable' };
    }
    const segments = path.startsWith('/') ? [] : filePath.replace(/\\/g, '/').split('/').slice(0, -1);
    for (const segment of path.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (!segments.length) return { kind: 'unavailable' };
        segments.pop();
      } else segments.push(segment);
    }
    if (!segments.length) return { kind: 'unavailable' };
    const line = value.match(/#L(\d+)/i)?.[1];
    return { kind: 'file', path: segments.join('/'), line: line ? Number(line) : undefined };
  } catch {
    return { kind: 'unavailable' };
  }
}
