import path from 'node:path';
import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';
import type { RuntimeEnvironmentResolver } from '../ports/runtime-environment-resolver.js';
import type { ToolHost } from '../ports/tool-host.js';

/**
 * Compatibility resolver for direct AgentLoop consumers that do not assemble
 * the production workspace resolver. Production wiring always injects one.
 */
export function runtimeEnvironmentResolver(
  explicit: RuntimeEnvironmentResolver | undefined,
  toolHost: ToolHost | undefined,
): RuntimeEnvironmentResolver {
  if (explicit) return explicit;
  return {
    async resolve({ projectId, threadId }) {
      const fromHost = toolHost?.environmentForToolContext
        ? await Promise.resolve(toolHost.environmentForToolContext({ threadId, projectId })).catch(() => null)
        : null;
      if (fromHost) return fromHost;
      const cwd = path.resolve(process.cwd());
      return localEnvironment(projectId ?? threadId, cwd);
    },
  };
}

export function localEnvironment(id: string, workspaceRoot: string): RuntimeEnvironment {
  const root = path.resolve(workspaceRoot);
  return {
    id,
    cwd: root,
    workspaceRoot: root,
    workspaceRoots: [root],
    shell: process.platform === 'win32' ? process.env.ComSpec || process.env.COMSPEC || 'cmd.exe' : '/bin/sh',
  };
}

