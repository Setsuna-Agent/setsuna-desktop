import type { RuntimeConfigState, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { RuntimeToolExecutionContext } from '../../ports/tool-host.js';

export function runtimePermissionsPrompt({
  approvalPolicy,
  context,
  tools,
}: {
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  context: RuntimeToolExecutionContext;
  tools: RuntimeToolDefinition[];
}): string {
  const environment = context.environment;
  const sandbox = context.sandboxWorkspaceWrite ?? {};
  const unrestrictedFileSystem = context.permissionProfile === 'danger-full-access';
  const readableRoots = sandbox.readableRoots?.length ? sandbox.readableRoots : [environment.workspaceRoot];
  const writableRoots = context.permissionProfile === 'read-only'
    ? []
    : sandbox.writableRoots?.length ? sandbox.writableRoots : [environment.workspaceRoot];
  const networkAccess = unrestrictedFileSystem || sandbox.networkAccess === true;
  const canRequestPermissions = tools.some((tool) => tool.name === 'request_permissions');

  return [
    'Runtime permissions for this sampling step:',
    `- Permission profile: ${context.permissionProfile}`,
    `- Approval policy: ${approvalPolicy}`,
    `- Network access: ${networkAccess ? 'enabled' : 'restricted'}`,
    `- Readable roots: ${unrestrictedFileSystem ? '(unrestricted)' : quotedPaths(readableRoots)}`,
    `- Writable roots: ${unrestrictedFileSystem ? '(unrestricted)' : writableRoots.length ? quotedPaths(writableRoots) : '(none)'}`,
    !unrestrictedFileSystem && sandbox.deniedRoots?.length ? `- Denied roots: ${quotedPaths(sandbox.deniedRoots)}` : '',
    !unrestrictedFileSystem && sandbox.deniedGlobPatterns?.length ? `- Denied path patterns: ${quotedPaths(sandbox.deniedGlobPatterns)}` : '',
    !tools.length
      ? 'No tools are available in this sampling step.'
      : approvalPolicy === 'full'
        ? 'The runtime automatically approves supported tool operations, but sandbox and path restrictions still apply.'
        : approvalPolicy === 'strict'
          ? 'The runtime requires explicit approval for sensitive operations. Use the normal tool call and let the runtime present the approval.'
          : 'Sensitive operations may require approval. Use the normal tool call and let the runtime request it when needed.',
    canRequestPermissions
      ? 'If a necessary path is outside the current roots, request the narrowest additional permission with request_permissions.'
      : '',
    'Do not claim access beyond this effective profile; runtime enforcement remains authoritative.',
  ].filter(Boolean).join('\n');
}

function quotedPaths(paths: string[]): string {
  return paths.map(quotedPath).join(', ');
}

function quotedPath(value: string): string {
  return JSON.stringify(value);
}
