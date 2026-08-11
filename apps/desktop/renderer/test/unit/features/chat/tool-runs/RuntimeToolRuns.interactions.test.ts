import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { toolRun, fileRun, renderedText, renderedTextFromHtml, firstToolRunSummaryHtml, renderedHtml } from './RuntimeToolRuns.support.js';

describe('RuntimeToolRuns shell and interaction summaries', () => {
  it('shows the command in the summary for a single shell run', () => {
    const text = renderedText([
      toolRun('shell_single', 'run_shell_command', { command: 'pnpm test:unit apps/desktop/renderer/test/unit/features/chat/tool-runs/runtimeFileChanges.test.ts' }),
    ]);

    expect(text).toContain('已运行 pnpm test:unit apps/desktop/renderer/test/unit/features/chat/tool-runs/runtimeFileChanges.test.ts');
    expect(text).not.toContain('已运行 1 条命令');
  });

  it('keeps a sandbox retry approval compact and shows the exec command', () => {
    const html = renderedHtml([{
      id: 'exec_retry',
      name: 'exec_command',
      status: 'pending_approval',
      argumentsPreview: '{"cmd":"pnpm dev"}',
      resultPreview: 'node:internal/child_process:420\nError: spawn EPERM\nfull stack trace',
      approvalId: 'approval_retry',
      approvalStatus: 'pending',
      approvalReason: 'Sandbox denied exec_command: Error: spawn EPERM. Approve retry without the OS sandbox.',
    }]);
    const text = renderedTextFromHtml(html);

    expect(text).toContain('等待授权：运行 pnpm dev');
    expect(text).toContain('$pnpm dev');
    expect(text).toContain('允许');
    expect(text).toContain('拒绝');
    expect(text).not.toContain('待确认');
    expect(text).not.toContain('spawn EPERM');
    expect(text).not.toContain('full stack trace');
    expect(text).not.toContain('$shell');
  });

  it('shows a single pending approval summary only once inside grouped tool history', () => {
    const pendingRun: RuntimeToolRun = {
      id: 'exec_pending',
      name: 'exec_command',
      status: 'pending_approval',
      argumentsPreview: '{"cmd":"cd /Users/dev/project && pnpm dev"}',
      approvalId: 'approval_pending',
      approvalStatus: 'pending',
    };
    const groupedShellHtml = renderedHtml([
      toolRun('exec_previous', 'exec_command', { cmd: 'pnpm typecheck' }),
      pendingRun,
    ], 'latest');
    const mixedHistoryHtml = renderedHtml([
      fileRun('edit_previous', 'edit_file', 'src/App.tsx', 'Modified'),
      pendingRun,
    ], 'latest');

    const mixedHistoryText = renderedTextFromHtml(mixedHistoryHtml);
    expect(mixedHistoryText.split('等待授权：运行')).toHaveLength(2);
    expect(mixedHistoryText).not.toContain('待确认');
    for (const html of [groupedShellHtml, mixedHistoryHtml]) {
      const text = renderedTextFromHtml(html);
      expect(html.match(/<summary/gu)).toHaveLength(1);
      expect(text).toContain('cd /Users/dev/project &amp;&amp; pnpm dev');
      expect(text).toContain('允许');
      expect(text).toContain('拒绝');
    }
  });

  it('uses the outer progress summary as the only loading state for one running tool', () => {
    const html = renderedHtml([
      toolRun('plan_previous', 'update_plan', { plan: [] }),
      toolRun('exec_running', 'exec_command', { cmd: 'cd /Users/dev/project && pnpm dev' }, 'running'),
    ], 'latest');
    const text = renderedTextFromHtml(html);

    expect(html.match(/<summary/gu)).toHaveLength(1);
    expect(text.split('正在运行')).toHaveLength(2);
    expect(text).toContain('cd /Users/dev/project &amp;&amp; pnpm dev');
    expect(text).not.toContain('已使用 update plan');
  });

  it('does not render Plan and Goal state-update tools in the transcript', () => {
    const html = renderedHtml([
      toolRun('plan_update', 'update_plan', { plan: [] }),
      toolRun('goal_update', 'update_goal', { status: 'complete' }),
    ]);

    expect(html).toBe('');
  });

  it('wraps adjacent file and shell groups into one mixed summary', () => {
    const runs = [
      fileRun('write_selection', 'write_file', 'selection_sort.py', 'Created'),
      toolRun('shell_single', 'run_shell_command', { command: 'python3 selection_sort.py' }),
    ];
    const text = renderedText(runs);
    const html = renderedHtml(runs);

    expect(html).toContain('chat-tool-run--mixed');
    expect(text).toContain('已创建 1 个文件，已运行 1 条命令');
    expect(text.match(/已创建 1 个文件/gu)).toHaveLength(1);
    expect(text).toContain('创建selection_sort.py');
    expect(text).toContain('+12-0');
    expect(text).toContain('已运行 python3 selection_sort.py');
  });

  it('can show the latest mixed operation as the outer summary', () => {
    const text = renderedText([
      toolRun('find_file', 'find_files', { query: 'quick_sort.py' }),
      toolRun('read_file', 'workspace_read_file', { path: 'quick_sort.py' }),
      fileRun('write_selection', 'write_file', 'selection_sort.py', 'Created'),
      toolRun('shell_single', 'run_shell_command', { command: 'python3 selection_sort.py' }),
    ], 'latest');

    expect(text).toContain('已运行 python3 selection_sort.py');
    expect(text).not.toContain('已查找 1 次文件，已读取 1 个文件，已创建 1 个文件');
  });

  it('does not label file lookups as inspected directories', () => {
    const text = renderedText([
      toolRun('find_file', 'find_files', { query: 'quick_sort.py' }),
      toolRun('read_file', 'workspace_read_file', { path: 'quick_sort.py' }),
    ]);

    expect(text).toContain('已查找 1 次文件，已读取 1 个文件');
    expect(text).toContain('已查找文件quick_sort.py');
    expect(text).toContain('已读取文件quick_sort.py');
    expect(text).not.toContain('已查看目录quick_sort.py');
  });

  it('normalizes inspection files and directories through workspace path renderers', () => {
    const workspaceRoot = '/Users/dev/project';
    const groupedHtml = renderedHtml([
      toolRun('list_src', 'list_directory', { path: `${workspaceRoot}/src` }),
      toolRun('read_index', 'read_file', { file_path: `${workspaceRoot}/index.html` }),
      toolRun('read_config', 'read_file', { file_path: `${workspaceRoot}/uno.config.ts` }),
      toolRun('list_components', 'list_directory', { path: `${workspaceRoot}/src/components` }),
      {
        ...toolRun('read_grid', 'read_file', { file_path: `${workspaceRoot}/src/components/Grid.tsx` }),
        hookRuns: [{
          id: 'inspection_hook',
          eventName: 'PostToolUse',
          handlerType: 'command',
          status: 'completed',
        }],
      },
    ]);
    const flatHtml = renderedHtml([
      toolRun('read_flat', 'read_file', { file_path: `${workspaceRoot}/src/index.css` }),
    ]);
    const runningGroupHtml = renderedHtml([
      toolRun('read_previous', 'read_file', { file_path: `${workspaceRoot}/index.html` }),
      toolRun('read_running', 'read_file', { file_path: `${workspaceRoot}/src/App.tsx` }, 'running'),
    ]);

    expect(renderedTextFromHtml(groupedHtml)).not.toContain(workspaceRoot);
    expect(groupedHtml).toContain('title="src"');
    expect(groupedHtml).toContain('title="src/components"');
    expect(groupedHtml).toContain('chat-workspace-path-label chat-tool-run__file-list-target');
    expect(groupedHtml).toContain('title="index.html"');
    expect(groupedHtml).toContain('title="src/components/Grid.tsx"');
    expect(groupedHtml).toContain('<span>Grid.tsx</span>');

    expect(renderedTextFromHtml(flatHtml)).toContain('已读取文件index.css');
    expect(renderedTextFromHtml(flatHtml)).not.toContain(workspaceRoot);
    expect(flatHtml).toContain('data-markdown-link="workspace-tool"');
    expect(flatHtml).toContain('title="src/index.css"');

    const runningSummaryHtml = firstToolRunSummaryHtml(runningGroupHtml);
    expect(renderedTextFromHtml(runningSummaryHtml)).toContain('正在读取文件App.tsx');
    expect(renderedTextFromHtml(runningSummaryHtml)).not.toContain(workspaceRoot);
    expect(runningSummaryHtml).toContain('title="src/App.tsx"');
  });

  it('summarizes web-content MCP runs without exposing raw arguments or fetched page text', () => {
    const html = renderedHtml([
      {
        ...toolRun('fetch_web', 'mcp search-mcp fetchWebContent', {
          url: 'https://tophub.today/c/brief/',
          maxChars: 15000,
        }),
        resultPreview: 'Daily\\n热门\\n今日更新的所有简报聚合内容',
      },
    ]);
    const text = renderedTextFromHtml(html);

    expect(text).toContain('已获取网页');
    expect(text).toContain('tophub.today/c/brief');
    expect(text).not.toContain('参数');
    expect(text).not.toContain('结果');
    expect(text).not.toContain('maxChars');
    expect(text).not.toContain('Daily');
    expect(html).not.toContain('chat-tool-run__preview');
  });

  it('uses a compact summary for grouped web-content MCP runs', () => {
    const text = renderedText([
      toolRun('fetch_brief', 'mcp search-mcp fetchWebContent', { url: 'https://tophub.today/c/brief/' }),
      toolRun('fetch_news', 'mcp search-mcp fetchWebContent', { url: 'https://news.qq.com/' }),
    ]);

    expect(text).toContain('已获取 2 个网页');
    expect(text).not.toContain('fetchWebContent');
    expect(text).not.toContain('已使用 2 次');
  });

  it('keeps pending generic tool approvals focused on the decision instead of raw JSON previews', () => {
    const html = renderedHtml([
      {
        ...toolRun('fetch_web', 'mcp search-mcp fetchWebContent', {
          url: 'https://news.qq.com/',
          maxChars: 15000,
        }, 'pending_approval'),
        approvalId: 'approval_1',
        approvalReason: '调用 MCP 工具：ziylike Search MCP / fetchWebContent',
      },
    ]);
    const text = renderedTextFromHtml(html);

    expect(text).toContain('等待授权：获取网页');
    expect(text).toContain('news.qq.com/');
    expect(text).toContain('允许');
    expect(text).toContain('拒绝');
    expect(text).not.toContain('调用 MCP 工具');
    expect(text).not.toContain('maxChars');
    expect(html).not.toContain('chat-tool-run__preview');
  });

  it('renders MCP form and URL elicitations as structured, query-redacted interactions', () => {
    const formHtml = renderedHtml([{
      id: 'call_form',
      name: 'mcp__profile__collect',
      status: 'pending_approval',
      approvalId: 'approval_form',
      approvalStatus: 'pending',
      elicitation: {
        mode: 'form',
        serverKey: 'profile',
        message: 'Provide your profile.',
        requestedSchema: {
          type: 'object',
          properties: {
            displayName: { type: 'string', title: '显示名称' },
            newsletter: { type: 'boolean', title: '订阅更新' },
          },
          required: ['displayName'],
        },
      },
    }]);
    const urlHtml = renderedHtml([{
      id: 'call_url',
      name: 'mcp__auth__login',
      status: 'pending_approval',
      approvalId: 'approval_url',
      approvalStatus: 'pending',
      elicitation: {
        mode: 'url',
        serverKey: 'auth',
        message: 'Authorize access.',
        displayUrl: 'https://example.com/authorize',
        elicitationId: 'elicit_1',
      },
    }]);

    expect(renderedTextFromHtml(formHtml)).toContain('MCP Server 请求输入');
    expect(renderedTextFromHtml(formHtml)).toContain('显示名称必填');
    expect(formHtml).toContain('name="displayName"');
    expect(renderedTextFromHtml(urlHtml)).toContain('允许并打开');
    expect(urlHtml).toContain('https://example.com/authorize');
    expect(urlHtml).not.toContain('one_time_token');
  });

  it('renders request_user_input as a structured form with options, defaults, and timeout status', () => {
    const html = renderedHtml([{
      id: 'call_input',
      name: 'request_user_input',
      status: 'pending_approval',
      approvalId: 'approval_input',
      approvalStatus: 'pending',
      userInput: {
        title: '发布目标',
        message: '请选择本次发布环境。',
        autoResolutionMs: 60_000,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        requestedSchema: {
          type: 'object',
          properties: {
            environment: {
              type: 'string',
              title: '环境',
              default: 'staging',
              oneOf: [
                { const: 'staging', title: '预发布', description: '先进行安全验证。' },
                { const: 'production', title: '生产' },
              ],
            },
            notes: { type: 'string', title: '备注', multiline: true, placeholder: '可选' },
          },
          required: ['environment'],
        },
      },
    }]);
    const text = renderedTextFromHtml(html);

    expect(text).toContain('发布目标');
    expect(text).toContain('请选择本次发布环境');
    expect(text).toContain('秒后自动继续');
    expect(text).toContain('环境必填');
    expect(text).toContain('先进行安全验证');
    expect(text).toContain('请勿在此填写密码');
    expect(html).toContain('<textarea');
    expect(html).toContain('value="staging" selected=""');
    expect(text).toContain('跳过');
  });
});
