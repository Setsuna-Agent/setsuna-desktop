import { runtimeText, type RuntimeInterfaceLanguage, type RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { MAX_PERSISTENT_SHELL_TTL_MS } from './pc-local-tool-constants.js';
import { shellOutputTokenBudgetSchema } from './pc-local-tool-definitions.js';

export function compatToolDefinitions(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition[] {
  const text = runtimeText(language);
  return [
    {
      name: 'request_permissions',
      description: text('Request additional sandbox permissions for later tool calls in this turn or session.', "为本轮或会话中的后续工具调用申请额外沙箱权限。"),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          environment_id: { type: 'string', description: text('Optional active environment id. The desktop runtime currently supports the active local environment only.', "可选当前环境 ID。桌面运行时目前只支持当前本地环境。") },
          environmentId: { type: 'string', description: text('Camel-case alias for environment_id.', "environment_id 的驼峰命名别名。") },
          reason: { type: 'string', description: text('User-facing reason for requesting broader permissions.', "面向用户说明为何需要更大的权限范围。") },
          permissions: {
            type: 'object',
            additionalProperties: false,
            properties: {
              network: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  enabled: { type: 'boolean', description: text('True requests network access.', "true 表示申请网络访问权限。") },
                },
              },
              file_system: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  write: { type: 'array', items: { type: 'string' }, description: text('Absolute or workspace-relative paths to grant write access.', "申请写权限的绝对路径或工作区相对路径。") },
                  read: { type: 'array', items: { type: 'string' }, description: text('Absolute or workspace-relative paths to grant read access.', "申请读权限的绝对路径或工作区相对路径。") },
                  entries: {
                    type: 'array',
                    description: text('Canonical filesystem permission entries.', "规范的文件系统权限条目。"),
                    items: {
                      type: 'object',
                      additionalProperties: true,
                      properties: {
                        access: { type: 'string', enum: ['read', 'write', 'deny'] },
                        path: {},
                      },
                    },
                  },
                },
              },
              fileSystem: {
                type: 'object',
                description: text('Camel-case alias for file_system.', "file_system 的驼峰命名别名。"),
                additionalProperties: true,
              },
            },
          },
        },
        required: ['permissions'],
      },
    },
    {
      name: 'exec_command',
      description: text('Run a shell command in the active local project.', "在当前本地项目中运行 shell 命令。"),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          shell: { type: 'string', description: text('Optional shell path accepted for caller compatibility; execution uses the platform shell.', "可选 shell 路径，供调用方兼容使用；实际执行使用平台 shell。") },
          cmd: { type: 'string', description: text('The shell command to run.', "要运行的 shell 命令。") },
          cwd: { type: 'string', description: text('Optional working directory, absolute or relative to the project root.', "可选工作目录，可为绝对路径或相对于项目根目录的路径。") },
          yield_time_ms: { type: 'integer', description: text('Milliseconds to wait before returning while the command keeps running.', "等待多少毫秒后返回，命令仍继续运行。"), minimum: 0, maximum: 30000 },
          timeout_ms: { type: 'integer', description: text('Optional timeout in milliseconds.', "可选超时（毫秒）。"), minimum: 1, maximum: 600000 },
          max_output_tokens: shellOutputTokenBudgetSchema(language),
          persist: { type: 'boolean', description: text('Keep a still-running dev server or watcher available after the current turn completes.', "本轮结束后保留仍在运行的开发服务器或监听器。") },
          persist_ttl_ms: { type: 'integer', description: text('Optional lifetime for a persisted process in milliseconds.', "可选持久化进程的存活时间（毫秒）。"), minimum: 1000, maximum: MAX_PERSISTENT_SHELL_TTL_MS },
          sandbox_permissions: { type: 'string', enum: ['use_default', 'with_additional_permissions', 'require_escalated'], description: text('Per-command sandbox override. Use with_additional_permissions only together with a non-empty additional_permissions request; otherwise omit this field or use use_default. require_escalated asks for unsandboxed execution.', "当前命令的沙箱权限覆盖。with_additional_permissions 必须配合非空的 additional_permissions；否则省略本字段或使用 use_default。require_escalated 表示申请沙箱外执行。") },
          additional_permissions: {
            type: 'object',
            description: text('Additional sandboxed filesystem or network access for this command. Only used with sandbox_permissions set to with_additional_permissions.', "本命令所需的额外沙箱内文件系统或网络权限。仅在 sandbox_permissions 为 with_additional_permissions 时使用。"),
            additionalProperties: false,
            properties: {
              network: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  enabled: { type: 'boolean', description: text('True requests network access for this command.', "true 表示为本命令申请网络访问权限。") },
                },
              },
              file_system: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  write: { type: 'array', items: { type: 'string' }, description: text('Absolute or workspace-relative paths to grant write access for this command.', "为本命令申请写权限的绝对路径或工作区相对路径。") },
                  read: { type: 'array', items: { type: 'string' }, description: text('Absolute or workspace-relative paths to grant read access for this command.', "为本命令申请读权限的绝对路径或工作区相对路径。") },
                },
              },
            },
          },
          justification: { type: 'string', description: text('User-facing approval reason for require_escalated.', "require_escalated 所需的面向用户的审批理由。") },
          prefix_rule: { type: 'array', items: { type: 'string' }, description: text('Reusable approval prefix accepted for caller compatibility.', "可复用的审批前缀，供调用方兼容使用。") },
        },
        required: ['cmd'],
      },
    },
    {
      name: 'write_stdin',
      description: text('Write characters to an existing shell session. Empty input polls the session.', "向已有 shell 会话写入字符；空输入用于轮询。"),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          session_id: { type: ['string', 'number'], description: text('Session identifier returned by exec_command.', "exec_command 返回的会话标识。") },
          chars: { type: 'string', description: text('Characters to write to stdin. Empty string polls for output.', "写入 stdin 的字符；空字符串表示轮询输出。") },
          yield_time_ms: { type: 'integer', description: text('Milliseconds to wait for output after polling.', "轮询时等待输出的毫秒数。"), minimum: 0, maximum: 30000 },
          max_output_tokens: shellOutputTokenBudgetSchema(language),
        },
        required: ['session_id'],
      },
    },
  ];
}
