import { runtimeText, type RuntimeConfigState, type RuntimeToolDefinition } from '@setsuna-desktop/contracts';
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
  const text = runtimeText(context.interfaceLanguage);
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
    text('Runtime permissions for this sampling step:', "本次模型请求的运行时权限："),
    text(`- Permission profile: ${context.permissionProfile}`, `- 权限模式：${context.permissionProfile}`),
    text(`- Approval policy: ${approvalPolicy}`, `- 审批策略：${approvalPolicy}`),
    text(`- Network access: ${networkAccess ? 'enabled' : 'restricted'}`, `- 网络访问：${networkAccess ? '已启用' : '受限'}`),
    text(`- Readable roots: ${unrestrictedFileSystem ? '(unrestricted)' : quotedPaths(readableRoots)}`, `- 可读根目录：${unrestrictedFileSystem ? '（不受限）' : quotedPaths(readableRoots)}`),
    text(`- Writable roots: ${unrestrictedFileSystem ? '(unrestricted)' : writableRoots.length ? quotedPaths(writableRoots) : '(none)'}`, `- 可写根目录：${unrestrictedFileSystem ? '（不受限）' : writableRoots.length ? quotedPaths(writableRoots) : '（无）'}`),
    !unrestrictedFileSystem && sandbox.deniedRoots?.length ? text(`- Denied roots: ${quotedPaths(sandbox.deniedRoots)}`, `- 禁止访问的根目录：${quotedPaths(sandbox.deniedRoots)}`) : '',
    !unrestrictedFileSystem && sandbox.deniedGlobPatterns?.length ? text(`- Denied path patterns: ${quotedPaths(sandbox.deniedGlobPatterns)}`, `- 禁止访问的路径模式：${quotedPaths(sandbox.deniedGlobPatterns)}`) : '',
    !tools.length
      ? text('No tools are available in this sampling step.', "本次模型请求没有可用工具。")
      : approvalPolicy === 'full'
        ? text('The runtime automatically approves supported tool operations, but sandbox and path restrictions still apply.', "运行时自动批准支持的工具操作，但沙箱和路径限制仍然生效。")
        : approvalPolicy === 'strict'
          ? text('The runtime requires explicit approval for sensitive operations. Request the needed access through an approval-capable tool call.', "敏感操作需要明确审批。请通过支持审批的工具调用申请所需访问权限。")
          : text('Sensitive operations may require approval. Request the needed access through an approval-capable tool call instead of skipping the operation.', "敏感操作可能需要审批。请通过支持审批的工具调用申请所需权限，不要直接跳过操作。"),
    canRequestPermissions
      ? text('If a necessary path is outside the current roots, request the narrowest additional permission with request_permissions.', "必要的路径超出当前根目录范围时，通过 request_permissions 申请最小的额外权限。")
      : '',
    canEscalateExec && approvalPolicy !== 'full'
      ? text('If an important exec_command fails with a likely sandbox or permission error, retry the same exec_command with sandbox_permissions set to require_escalated and include a concise user-facing justification. Do not skip required validation solely because the sandboxed attempt failed.', "重要的 exec_command 疑似因沙箱或权限失败时，用相同命令重试，将 sandbox_permissions 设为 require_escalated，并提供简短、面向用户的 justification。不要仅因沙箱内执行失败就跳过必要验证。")
      : '',
    text('Do not claim access beyond this effective profile; runtime enforcement remains authoritative.', "不得声称拥有超出当前有效权限模式的访问能力；以运行时实际执行的权限限制为准。"),
  ].filter(Boolean).join('\n');
}

function quotedPaths(paths: string[]): string {
  return paths.map(quotedPath).join(', ');
}

function quotedPath(value: string): string {
  return JSON.stringify(value);
}
