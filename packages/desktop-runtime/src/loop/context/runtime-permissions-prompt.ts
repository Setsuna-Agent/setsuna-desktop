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
  const canEscalateExec = tools.some((tool) => tool.name === 'exec_command');

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
          ? 'The runtime requires explicit approval for sensitive operations. Request the needed access through an approval-capable tool call.'
          : 'Sensitive operations may require approval. Request the needed access through an approval-capable tool call instead of skipping the operation.',
    canRequestPermissions
      ? 'If a necessary path is outside the current roots, request the narrowest additional permission with request_permissions.'
      : '',
    canEscalateExec && approvalPolicy !== 'full'
      ? 'If an important exec_command fails with a likely sandbox or permission error, retry the same exec_command with sandbox_permissions set to require_escalated and include a concise user-facing justification. Do not skip required validation solely because the sandboxed attempt failed.'
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
