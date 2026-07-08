import type { RuntimeHookInput } from '@setsuna-desktop/contracts';

export type HookPresetCategory = 'security' | 'review' | 'context' | 'workflow';

export type HookPreset = RuntimeHookInput & {
  id: string;
  name: string;
  description: string;
  category: HookPresetCategory;
  categoryLabel: string;
  outcome: string;
  recommendedFor: string;
};

const SHELL_COMMAND_MATCHER = 'run_shell_command|exec_command';
const FILE_PATH_MATCHER = 'workspace_read_file|workspace_write_file|read_file|write_file|edit|edit_file|append_file|delete_file|apply_patch';
const FILE_MUTATION_MATCHER = 'workspace_write_file|write_file|edit|edit_file|append_file|delete_file|apply_patch';

export const hookPresets: HookPreset[] = [
  {
    id: 'guard-dangerous-shell',
    name: '阻止危险 Shell 命令',
    description: '拦截删除根目录、格式化磁盘、强制清理 Git 工作区等高危命令，适合打开高权限工具时兜底。',
    category: 'security',
    categoryLabel: '安全',
    eventName: 'PreToolUse',
    matcher: SHELL_COMMAND_MATCHER,
    command: nodeHook(`
      let input = '';
      process.stdin.on('data', (chunk) => input += chunk);
      process.stdin.on('end', () => {
        const payload = JSON.parse(input || '{}');
        const toolInput = payload.tool_input || payload.toolInput || {};
        const command = String(toolInput.command || toolInput.cmd || '');
        const dangerous = [
          /\\brm\\s+-rf\\s+(?:\\/|~|\\.\\.?\\s*$)/i,
          /\\bsudo\\s+rm\\b/i,
          /\\bmkfs(?:\\.|\\s)/i,
          /\\bdiskutil\\s+erase/i,
          /\\bdd\\s+if=.*\\bof=\\/dev\\//i,
          /\\bgit\\s+(?:reset\\s+--hard|clean\\s+-fdx?)\\b/i,
          /:\\s*\\(\\)\\s*\\{\\s*:\\|:\\s*&\\s*\\}\\s*;/,
        ];
        if (dangerous.some((pattern) => pattern.test(command))) {
          process.stderr.write('危险 shell 命令已被默认 Hook 阻止，请确认后手动调整命令或停用该 Hook。');
          process.exit(2);
        }
      });
    `),
    commandWindows: nodeHook(`
      let input = '';
      process.stdin.on('data', (chunk) => input += chunk);
      process.stdin.on('end', () => {
        const payload = JSON.parse(input || '{}');
        const toolInput = payload.tool_input || payload.toolInput || {};
        const command = String(toolInput.command || toolInput.cmd || '');
        const dangerous = [
          /\\bRemove-Item\\b[\\s\\S]*\\b-Recurse\\b[\\s\\S]*\\b-Force\\b/i,
          /\\bformat\\s+[a-z]:/i,
          /\\bClear-Disk\\b/i,
          /\\bdel\\s+\\/s\\s+\\/q\\s+[a-z]:\\\\/i,
          /\\bgit\\s+(?:reset\\s+--hard|clean\\s+-fdx?)\\b/i,
        ];
        if (dangerous.some((pattern) => pattern.test(command))) {
          process.stderr.write('危险 shell 命令已被默认 Hook 阻止，请确认后手动调整命令或停用该 Hook。');
          process.exit(2);
        }
      });
    `),
    timeoutSec: 10,
    statusMessage: '检查危险命令',
    outcome: '命中后阻止工具执行',
    recommendedFor: '高权限、自动执行 shell 较多的项目',
  },
  {
    id: 'protect-secret-paths',
    name: '保护密钥文件路径',
    description: '读取、写入或 patch 参数中出现 .env、SSH 私钥、npm/pypi 凭证等路径时直接拦截。',
    category: 'security',
    categoryLabel: '安全',
    eventName: 'PreToolUse',
    matcher: FILE_PATH_MATCHER,
    command: nodeHook(`
      let input = '';
      process.stdin.on('data', (chunk) => input += chunk);
      process.stdin.on('end', () => {
        const payload = JSON.parse(input || '{}');
        const text = JSON.stringify(payload.tool_input || payload.toolInput || {});
        const sensitivePath = /(^|[\\\\/])(?:\\.env(?:\\.|$)|id_rsa|id_ed25519|\\.npmrc|\\.pypirc|credentials(?:\\.json)?|service-account(?:\\.json)?)(?:[\\\\/]|$)?/i;
        if (sensitivePath.test(text)) {
          process.stderr.write('敏感文件路径已被默认 Hook 阻止，如确需处理请临时停用或改写该 Hook。');
          process.exit(2);
        }
      });
    `),
    timeoutSec: 10,
    statusMessage: '检查敏感文件',
    outcome: '命中后阻止工具执行',
    recommendedFor: '含生产密钥、本地凭证或私钥的工作区',
  },
  {
    id: 'protect-generated-folders',
    name: '避免写入生成目录',
    description: '阻止直接改动 node_modules、dist、build、coverage、target 等生成目录，降低误写依赖或产物的概率。',
    category: 'security',
    categoryLabel: '安全',
    eventName: 'PreToolUse',
    matcher: FILE_MUTATION_MATCHER,
    command: nodeHook(`
      let input = '';
      process.stdin.on('data', (chunk) => input += chunk);
      process.stdin.on('end', () => {
        const payload = JSON.parse(input || '{}');
        const text = JSON.stringify(payload.tool_input || payload.toolInput || {});
        const generatedPath = /(^|[\\\\/])(?:node_modules|dist|build|coverage|target|\\.next|\\.turbo)(?:[\\\\/]|$)/i;
        if (generatedPath.test(text)) {
          process.stderr.write('默认 Hook 阻止了对生成目录或依赖目录的直接写入。');
          process.exit(2);
        }
      });
    `),
    timeoutSec: 10,
    statusMessage: '检查生成目录',
    outcome: '命中后阻止写入',
    recommendedFor: '前端、Node、Rust 或有大量构建产物的仓库',
  },
  {
    id: 'audit-file-mutations',
    name: '文件改动审计提示',
    description: '文件写入、编辑或 patch 成功后，在工具记录里留下 review 提醒，不阻断后续流程。',
    category: 'review',
    categoryLabel: '审计',
    eventName: 'PostToolUse',
    matcher: FILE_MUTATION_MATCHER,
    command: nodeHook(`
      let input = '';
      process.stdin.on('data', (chunk) => input += chunk);
      process.stdin.on('end', () => {
        const payload = JSON.parse(input || '{}');
        const toolName = payload.tool_name || payload.toolName || 'file tool';
        process.stdout.write(JSON.stringify({
          systemMessage: '文件改动工具 ' + toolName + ' 已完成，提交前请 review diff 并运行必要验证。'
        }));
      });
    `),
    timeoutSec: 10,
    statusMessage: '记录文件改动',
    outcome: '显示审计提醒',
    recommendedFor: '希望每次文件写入后都有可见提醒的团队',
  },
  {
    id: 'session-start-project-guidance',
    name: '会话开始读取项目提示',
    description: '会话启动、恢复、清空或压缩后，提示模型优先遵守工作区里的 AGENTS.md、README.md 等项目约定。',
    category: 'context',
    categoryLabel: '上下文',
    eventName: 'SessionStart',
    matcher: '*',
    command: nodeHook(`
      const fs = require('fs');
      const path = require('path');
      let input = '';
      process.stdin.on('data', (chunk) => input += chunk);
      process.stdin.on('end', () => {
        const payload = JSON.parse(input || '{}');
        const cwd = String(payload.cwd || process.cwd());
        const candidates = ['AGENTS.md', 'CONTRIBUTING.md', 'README.md'];
        const existing = candidates.filter((file) => fs.existsSync(path.join(cwd, file)));
        if (!existing.length) return;
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'Project guidance files in cwd: ' + existing.join(', ') + '. Read and follow them before making code changes. Session source: ' + String(payload.source || 'unknown') + '.'
          }
        }));
      });
    `),
    timeoutSec: 10,
    statusMessage: '注入项目提示',
    outcome: '给模型追加上下文',
    recommendedFor: '依赖 AGENTS.md、README 或贡献约定的项目',
  },
  {
    id: 'prompt-secret-detector',
    name: '用户消息密钥提醒',
    description: '提交消息里看起来包含 API key、token、私钥片段时停止本轮，提醒用户先脱敏。',
    category: 'security',
    categoryLabel: '安全',
    eventName: 'UserPromptSubmit',
    command: nodeHook(`
      let input = '';
      process.stdin.on('data', (chunk) => input += chunk);
      process.stdin.on('end', () => {
        const payload = JSON.parse(input || '{}');
        const prompt = String(payload.prompt || '');
        const secretLike = /(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|AKIA[0-9A-Z]{16})/;
        if (secretLike.test(prompt)) {
          process.stdout.write(JSON.stringify({
            continue: false,
            stopReason: '这条消息看起来包含密钥或私钥片段。请先脱敏，再重新发送。'
          }));
        }
      });
    `),
    timeoutSec: 10,
    statusMessage: '检查消息密钥',
    outcome: '命中后停止本轮',
    recommendedFor: '经常粘贴日志、配置或报错信息的工作流',
  },
  {
    id: 'compact-warning',
    name: '压缩前状态提示',
    description: '上下文自动或手动压缩时，在 hook 记录里标记触发来源，方便排查压缩发生在什么时候。',
    category: 'workflow',
    categoryLabel: '流程',
    eventName: 'PreCompact',
    matcher: '*',
    command: nodeHook(`
      let input = '';
      process.stdin.on('data', (chunk) => input += chunk);
      process.stdin.on('end', () => {
        const payload = JSON.parse(input || '{}');
        process.stdout.write(JSON.stringify({
          systemMessage: '即将执行 ' + String(payload.trigger || 'unknown') + ' context compaction。'
        }));
      });
    `),
    timeoutSec: 10,
    statusMessage: '记录压缩触发',
    outcome: '显示压缩提示',
    recommendedFor: '调试长上下文、自动压缩或记忆链路',
  },
  {
    id: 'stop-todo-continuation',
    name: '结束前检查未完成 TODO',
    description: '如果助手最后一条回复仍包含显眼的 TODO / FIXME 标记，就要求继续补完，不让回合直接结束。',
    category: 'workflow',
    categoryLabel: '流程',
    eventName: 'Stop',
    command: nodeHook(`
      let input = '';
      process.stdin.on('data', (chunk) => input += chunk);
      process.stdin.on('end', () => {
        const payload = JSON.parse(input || '{}');
        if (payload.stop_hook_active) return;
        const message = String(payload.last_assistant_message || '');
        if (/\\b(?:TODO|FIXME|XXX)\\b/.test(message)) {
          process.stdout.write(JSON.stringify({
            decision: 'block',
            reason: '最后回复仍包含 TODO/FIXME 标记。请继续完成或明确解释为什么保留。'
          }));
        }
      });
    `),
    timeoutSec: 10,
    statusMessage: '检查未完成事项',
    outcome: '命中后要求继续',
    recommendedFor: '希望代理不要带着明显 TODO 收尾的场景',
  },
];

function nodeHook(script: string): string {
  return `node -e ${JSON.stringify(compactHookScript(script))}`;
}

function compactHookScript(script: string): string {
  return script
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}
