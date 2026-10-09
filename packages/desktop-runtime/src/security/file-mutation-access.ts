import type { RuntimeToolExecutionContext } from '../ports/tool-host.js';
import path from 'node:path';
import { fileMutationPathsForPolicy } from './file-system-policy.js';
import { canonicalFilesystemPath, canonicalFilesystemRoots, pathWithinRoot } from './workspace-path-policy.js';
import { recordInput } from '../shared/unknown.js';

/** Concrete paths keep approval grants independent of later cwd or primary-directory changes. */
export function externalFileMutationPaths(toolName: string, args: unknown, context: RuntimeToolExecutionContext): string[] {
  if (context.permissionProfile === 'danger-full-access') return [];
  const base = context.environment.workspaceRoot;
  const roots = canonicalFilesystemRoots([...context.environment.workspaceRoots, base, ...(context.sandboxWorkspaceWrite?.writableRoots ?? [])], base);
  const input = recordInput(args);
  const deletions = new Set(toolName === 'apply_patch'
    ? [...String(input.patch ?? '').matchAll(/^\*\*\* Delete File: (.+)$/gmu)]
      .map((match) => path.resolve(base, typeof input.workdir === 'string' ? input.workdir : '.', match[1].trim())) : []);
  const paths = fileMutationPathsForPolicy(toolName, args).map((filePath) => {
    const absolute = path.resolve(base, filePath);
    return toolName === 'delete_file' || deletions.has(absolute)
      ? path.join(canonicalFilesystemPath(path.dirname(absolute)), path.basename(absolute))
      : canonicalFilesystemPath(absolute);
  });
  return [...new Set(paths.filter((target) => !roots.some((root) => pathWithinRoot(target, root))))];
}
