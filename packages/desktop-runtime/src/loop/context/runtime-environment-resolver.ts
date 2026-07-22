import type { RuntimeEnvironment } from '@setsuna-desktop/contracts';
import path from 'node:path';
import type { RuntimeEnvironmentResolver } from '../../ports/runtime-environment-resolver.js';
import type { ToolHost } from '../../ports/tool-host.js';

/**
 * 为未组装生产环境工作区解析器、直接使用 AgentLoop 的调用方提供兼容解析器。
 * 生产环境接线始终会注入正式解析器。
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
