import type {
  RuntimeModelRequestStepSnapshot,
  RuntimePluginSummary,
  RuntimeSkillSummary,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { runtimePluginUsesByTurn } from '../../../../../src/features/chat/artifacts/runtimePluginUsage.js';

describe('runtimePluginUsesByTurn', () => {
  it('keeps persisted Plugin Skill attribution without the installed Plugin list', () => {
    const thread = runtimeThread({
      selectedSkills: [{
        id: 'documents.documents',
        name: 'Word 文档处理',
        plugin: { id: 'documents', name: 'Word 文档处理', icon: 'documents' },
      }],
    });

    expect(runtimePluginUsesByTurn(thread, [], []).get('turn_1')).toEqual([
      { id: 'documents', name: 'Word 文档处理', icon: 'documents' },
    ]);
  });

  it('merges legacy Skill snapshots, Plugin Hooks, resources, and MCP calls by Plugin id', () => {
    const thread = runtimeThread({
      selectedSkills: [{ id: 'documents.documents', name: 'Word 文档处理' }],
    });
    thread.messages = [{
      id: 'assistant_1',
      turnId: 'turn_1',
      role: 'assistant',
      content: '',
      createdAt: '2026-07-17T00:00:02.000Z',
      hookRuns: [{
        id: 'hook_1',
        turnId: 'turn_1',
        eventName: 'PreToolUse',
        handlerType: 'command',
        status: 'completed',
        source: 'plugin',
        pluginId: 'guard-dangerous-shell',
      }],
      toolRuns: [
        { id: 'mcp_1', name: 'mcp__docs-server__search', status: 'success' },
        {
          id: 'resource_1',
          name: 'read_plugin_resource',
          status: 'success',
          argumentsPreview: '{"pluginId":"documents","resourceId":"content-spec"}',
        },
      ],
    }];
    const skills: RuntimeSkillSummary[] = [{
      id: 'documents.documents',
      name: 'Word 文档处理',
      kind: 'plugin',
      enabled: true,
      selected: true,
      pluginId: 'documents',
    }];
    const plugins = [
      plugin('documents', 'Word 文档处理'),
      plugin('guard-dangerous-shell', '危险命令防护'),
      plugin('docs-mcp', '文档搜索', 'docs-server'),
    ];

    expect(runtimePluginUsesByTurn(thread, skills, plugins).get('turn_1')).toEqual([
      expect.objectContaining({ id: 'documents', name: 'Word 文档处理' }),
      expect.objectContaining({ id: 'guard-dangerous-shell', name: '危险命令防护' }),
      expect.objectContaining({ id: 'docs-mcp', name: '文档搜索' }),
    ]);
  });

  it('attributes a native tool run through its persisted pluginId data', () => {
    const thread = runtimeThread({ selectedSkills: [] });
    thread.messages = [{
      id: 'assistant_image',
      turnId: 'turn_1',
      role: 'assistant',
      content: '',
      createdAt: '2026-07-17T00:00:02.000Z',
      toolRuns: [{
        id: 'image_1',
        name: 'generate_image',
        status: 'success',
        data: { pluginId: 'openai-image-generation', imageCount: 1 },
      }],
    }];

    expect(runtimePluginUsesByTurn(thread, [], [plugin('openai-image-generation', '图片生成')]).get('turn_1'))
      .toEqual([expect.objectContaining({ id: 'openai-image-generation', name: '图片生成' })]);
  });

  it('attributes a running native tool from its start-time Plugin reference', () => {
    const thread = runtimeThread({ selectedSkills: [] });
    thread.messages = [{
      id: 'assistant_image',
      turnId: 'turn_1',
      role: 'assistant',
      content: '',
      createdAt: '2026-07-17T00:00:02.000Z',
      toolRuns: [{
        id: 'image_1',
        name: 'generate_image',
        status: 'running',
        plugin: { id: 'openai-image-generation', name: '图片生成', icon: 'image-generation' },
      }],
    }];

    expect(runtimePluginUsesByTurn(thread, [], []).get('turn_1')).toEqual([{
      id: 'openai-image-generation',
      name: '图片生成',
      icon: 'image-generation',
    }]);
  });
});

function runtimeThread(snapshot: Pick<RuntimeModelRequestStepSnapshot, 'selectedSkills'>): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Plugin use',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    lastSeq: 0,
    messages: [],
    turns: [{
      id: 'turn_1',
      items: [],
      stepSnapshots: [{
        createdAt: '2026-07-17T00:00:01.000Z',
        snapshot: snapshot as RuntimeModelRequestStepSnapshot,
      }],
    }],
  };
}

function plugin(id: string, name: string, mcpServerKey?: string): RuntimePluginSummary {
  return {
    id,
    name,
    installedAt: '2026-07-17T00:00:00.000Z',
    skills: [],
    mcpServers: mcpServerKey ? [{ key: mcpServerKey, label: mcpServerKey, transport: 'stdio', owned: true }] : [],
    hooks: [],
    hookCount: 0,
    resources: [],
  };
}
