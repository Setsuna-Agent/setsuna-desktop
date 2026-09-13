import type { RuntimeMessage, RuntimeModelRequestStepSnapshot, RuntimePluginSummary, RuntimeThread } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { createAssistantGuidanceTimelinePlan } from '../../../../../src/features/chat/conversation/chatAssistantGuidanceTimeline.js';
import { createAssistantRunTimeline } from '../../../../../src/features/chat/conversation/chatAssistantTimeline.js';
import { reconcileRuntimePluginUsesByTurn, runtimePluginUsesByTurn } from '../../../../../src/features/chat/plugin-usage/runtimePluginUsage.js';

describe('plugin usage transcript order', () => {
  it('appends native and MCP plugin records at their first calls while preserving earlier text and guidance', () => {
    const before = assistant('before', 1, '先检查本地仓库。');
    before.toolRuns = [{ id: 'local', name: 'run_shell_command', status: 'success' }];
    const guidance: RuntimeMessage = { ...assistant('guidance', 2, '也查一下远端。'), role: 'user' };
    const search = assistant('search', 3, '现在查询远端。');
    search.toolRuns = [{ id: 'web', name: 'web_search', status: 'running', plugin: { id: 'web-search', name: '网络搜索' } }];
    const plugins = [catalogPlugin('github', 'github-server'), catalogPlugin('web-search')];
    const initial = thread([before, guidance, search]);
    const initialUses = runtimePluginUsesByTurn(initial, [], plugins);
    const initialOrder = transcriptOrder(initial, initialUses, [guidance]);
    expect(initialOrder).toEqual(['text:before', 'tool:local', 'guidance:guidance', 'text:search', 'plugin:web-search', 'tool:web']);

    const completeSearch: RuntimeMessage = {
      ...search,
      toolRuns: [
        { ...search.toolRuns[0]!, status: 'success' },
        { id: 'middle', name: 'run_shell_command', status: 'success' },
        { id: 'github', name: 'mcp__github-server__get_me', status: 'success' },
        { id: 'github_again', name: 'mcp__github-server__list_repos', status: 'success' },
      ],
    };
    const answer = { ...assistant('answer', 4, '查询完成。'), phase: 'final_answer' as const };
    const completed = thread([before, guidance, completeSearch, answer]);
    const uses = reconcileRuntimePluginUsesByTurn(initialUses, runtimePluginUsesByTurn(completed, [], plugins));
    expect(transcriptOrder(completed, uses, [guidance])).toEqual([
      ...initialOrder, 'tool:middle', 'plugin:github', 'tool:github', 'tool:github_again', 'text:answer',
    ]);
  });

  it('anchors a later Skill injection to its sampling response and retains an earlier tool use when both exist', () => {
    const before = assistant('before', 1, '检查文件。');
    before.toolRuns = [{ id: 'read', name: 'read_plugin_resource', status: 'success', argumentsPreview: '{"pluginId":"documents"}' }];
    const after = assistant('after', 3, '开始处理文档。');
    const current = thread([before, after]);
    current.turns = [{
      id: 'turn_1', items: [], stepSnapshots: [{
        createdAt: timestamp(4),
        snapshot: {
          conversationMessageIds: [before.id],
          selectedSkills: [
            { id: 'pdf.skill', name: 'PDF', plugin: { id: 'pdf', name: 'PDF' } },
            { id: 'documents.skill', name: 'Documents', plugin: { id: 'documents', name: 'Documents' } },
          ],
        } as RuntimeModelRequestStepSnapshot,
      }],
    }];
    expect(transcriptOrder(current)).toEqual([
      'text:before', 'plugin:documents', 'tool:read', 'plugin:pdf', 'text:after',
    ]);
  });

  it('keeps post-tool and turn-end Hooks after their sources, including Hooks stored on the user message', () => {
    const input: RuntimeMessage = {
      ...assistant('input', 0, '生成图片。'), role: 'user',
      hookRuns: [{
        id: 'prompt', eventName: 'UserPromptSubmit', handlerType: 'command', status: 'completed',
        pluginId: 'prompt-plugin', startedAt: timestamp(1),
      }, {
        id: 'stop', eventName: 'Stop', handlerType: 'command', status: 'completed',
        pluginId: 'stop-plugin', startedAt: timestamp(5),
      }],
    };
    const generate = assistant('generate', 1, '正在生成。');
    generate.toolRuns = [{
      id: 'image', name: 'generate_image', status: 'success', plugin: { id: 'image-generation', name: 'Images' },
      hookRuns: [{ id: 'post', eventName: 'PostToolUse', handlerType: 'command', status: 'completed', pluginId: 'audit' }],
    }];
    const answer = { ...assistant('answer', 4, '图片已生成。'), phase: 'final_answer' as const };
    expect(transcriptOrder(thread([input, generate, answer]), undefined, [], {
      isTimelineToolResult: (run) => run.id === 'image',
    })).toEqual(['plugin:prompt-plugin', 'text:generate', 'plugin:image-generation', 'result:image', 'plugin:audit', 'text:answer', 'plugin:stop-plugin']);
  });
});

function transcriptOrder(
  current: RuntimeThread,
  uses = runtimePluginUsesByTurn(current, [], []),
  guidanceMessages: RuntimeMessage[] = [],
  options: Parameters<typeof createAssistantRunTimeline>[2] = {},
): string[] {
  const blocks = createAssistantRunTimeline(current.messages.filter((message) => message.role === 'assistant'), uses.get('turn_1'), options);
  const plan = createAssistantGuidanceTimelinePlan({ blocks, guidanceMessages, messageOrderIds: current.messages.map(({ id }) => id), turnActive: false });
  return plan.nodes.flatMap((node): string[] => {
    if (node.type === 'block') {
      if (node.block.type === 'content') return [`text:${node.block.segment.id}`];
      if (node.block.type === 'toolResult') return [`result:${node.block.run.id}`];
      return [];
    }
    return node.entries.flatMap((entry): string[] => {
      if (entry.type === 'guidance') return entry.messages.map(({ id }) => `guidance:${id}`);
      if (entry.item.type === 'pluginUses') return entry.item.plugins.map(({ id }) => `plugin:${id}`);
      if (entry.item.type === 'toolRuns') return entry.item.toolRuns.map(({ id }) => `tool:${id}`);
      if (entry.item.type === 'content') return [`text:${entry.item.segment.segment.id}`];
      return [];
    });
  });
}

function timestamp(second: number) { return `2026-09-13T00:00:0${second}.000Z`; }

function assistant(id: string, second: number, content: string): RuntimeMessage {
  return { id, turnId: 'turn_1', role: 'assistant', content, createdAt: timestamp(second), status: 'complete', phase: 'commentary' };
}

function thread(messages: RuntimeMessage[]): RuntimeThread {
  return {
    id: 'thread_1', title: 'Plugin order', createdAt: timestamp(0), updatedAt: timestamp(5),
    archived: false, messageCount: messages.length, lastMessagePreview: '', lastSeq: 0, messages,
  };
}

function catalogPlugin(id: string, mcpKey?: string): RuntimePluginSummary {
  return {
    id, name: id, installedAt: timestamp(0), skills: [], hooks: [], hookCount: 0, resources: [],
    mcpServers: mcpKey ? [{ key: mcpKey, label: mcpKey, transport: 'stdio', owned: true }] : [],
  };
}
