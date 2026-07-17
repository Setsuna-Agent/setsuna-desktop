import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CapabilitiesInstalledPluginListItem } from './CapabilitiesInstalledPluginListItem.js';
import { CapabilitiesPluginDetail } from './CapabilitiesPluginDetail.js';
import { CapabilitiesPluginEditorial } from './CapabilitiesPluginEditorial.js';
import { CapabilitiesPluginIcon } from './CapabilitiesPluginIcon.js';
import { CapabilitiesPluginListItem } from './CapabilitiesPluginListItem.js';

describe('capabilities plugin components', () => {
  it('renders an installed local plugin as a lightweight list row', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesInstalledPluginListItem
        plugin={{
          id: 'demo',
          name: 'Demo Plugin',
          icon: 'context7',
          version: '1.2.3',
          description: 'Local plugin fixture',
          publisher: 'Setsuna',
          tags: ['文档'],
          installedAt: '2026-07-15T00:00:00.000Z',
          skills: [{ id: 'demo.docs', name: 'Docs', description: 'Read project documentation.' }],
          mcpServers: [{ key: 'demo_docs', label: 'Demo Docs', description: 'Search documentation.', transport: 'streamableHttp', owned: true }],
          hooks: [{ id: 'demo-audit', name: 'Audit changes', eventName: 'PostToolUse' }],
          hookCount: 1,
          resources: [{ id: 'guide', label: 'Guide', path: 'resources/guide.md', size: 8 }],
        }}
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain('Demo Plugin');
    expect(html).toContain('已安装');
    expect(html).toContain('查看');
    expect(html).not.toContain('desktop-capability-card');
    expect(html).not.toContain('卸载');
  });

  it('renders a one-click marketplace row without card chrome or local paths', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginListItem
        plugin={{
          id: 'openai-docs',
          name: 'OpenAI 官方文档',
          icon: 'openai-docs',
          version: '1.0.0',
          description: '查询最新官方开发文档。',
          publisher: 'OpenAI',
          tags: ['官方', '开发文档'],
          featured: true,
          skills: [{ id: 'openai-docs.openai-docs', name: 'OpenAI 官方文档', description: '查询 OpenAI 官方文档。' }],
          mcpServers: [{ key: 'openai_docs', label: 'OpenAI Developer Docs', description: '官方文档服务', transport: 'streamableHttp' }],
          hooks: [],
          capabilities: { skills: 1, mcpServers: 1, hooks: 0, resources: 0 },
          installed: false,
        }}
        installing={false}
        onInstall={async () => undefined}
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain('OpenAI 官方文档');
    expect(html).toContain('1 个技能');
    expect(html).toContain('1 个服务');
    expect(html).toContain('获取');
    expect(html).not.toContain('desktop-capability-card');
    expect(html).not.toContain('目录');
    expect(html).not.toContain('plugin.json');
  });

  it('renders a featured plugin as editorial artwork instead of a card', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginEditorial
        plugin={{
          id: 'pdf',
          name: 'PDF 文档处理',
          icon: 'pdf',
          version: '1.0.0',
          description: '读取、创建和验证 PDF。',
          publisher: 'Setsuna',
          tags: ['PDF'],
          featured: true,
          skills: [{ id: 'pdf.pdf', name: 'PDF' }],
          mcpServers: [],
          hooks: [],
          capabilities: { skills: 1, mcpServers: 0, hooks: 0, resources: 0 },
          installed: false,
        }}
        installing={false}
        onInstall={async () => undefined}
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain('编辑推荐');
    expect(html).toContain('desktop-plugin-editorial__art');
    expect(html).toContain('获取');
    expect(html).not.toContain('desktop-capability-card');
  });

  it('shows the skills and MCP servers included in a marketplace plugin before installation', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        installing={false}
        marketplacePlugin={{
          id: 'openai-docs',
          name: 'OpenAI 官方文档',
          icon: 'openai-docs',
          version: '1.0.0',
          description: '查询最新官方开发文档。',
          publisher: 'OpenAI',
          tags: ['官方', '开发文档'],
          featured: true,
          skills: [{ id: 'openai-docs.openai-docs', name: 'OpenAI 官方文档', description: '查询 OpenAI API 与 Codex 文档。' }],
          mcpServers: [{ key: 'openai_docs', label: 'OpenAI Developer Docs', description: 'OpenAI 官方文档服务', transport: 'streamableHttp' }],
          hooks: [],
          capabilities: { skills: 1, mcpServers: 1, hooks: 0, resources: 0 },
          installed: false,
        }}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
      />,
    );

    expect(html).toContain('OpenAI 官方文档');
    expect(html).toContain('OpenAI API 与 Codex 文档');
    expect(html).toContain('OpenAI Developer Docs');
    expect(html).toContain('远程 MCP');
    expect(html).toContain('安装插件');
  });

  it('shows Hook details without exposing the executable command', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginDetail
        error={null}
        installing={false}
        marketplacePlugin={{
          id: 'guard-dangerous-shell',
          name: '阻止危险 Shell 命令',
          icon: 'guard-dangerous-shell',
          description: '拦截高危命令。',
          publisher: 'Setsuna',
          tags: ['安全'],
          featured: true,
          skills: [],
          mcpServers: [],
          hooks: [{
            id: 'guard-dangerous-shell',
            name: '阻止危险 Shell 命令',
            description: '在工具执行前识别破坏性命令。',
            eventName: 'PreToolUse',
            matcher: 'run_shell_command|exec_command',
          }],
          capabilities: { skills: 0, mcpServers: 0, hooks: 1, resources: 0 },
          installed: false,
        }}
        removing={false}
        onBack={() => undefined}
        onInstall={async () => undefined}
        onRemove={async () => undefined}
      />,
    );

    expect(html).toContain('在工具执行前识别破坏性命令');
    expect(html).toContain('PreToolUse');
    expect(html).toContain('run_shell_command|exec_command');
    expect(html).not.toContain('{{pluginRoot}}');
    expect(html).not.toContain('.mjs');
  });

  it('renders a distinct glyph and tone for every bundled plugin icon', () => {
    const names = [
      'context7',
      'openai-docs',
      'pdf',
      'guard-dangerous-shell',
      'protect-secret-paths',
      'protect-generated-folders',
      'audit-file-mutations',
      'session-start-project-guidance',
      'prompt-secret-detector',
      'compact-warning',
      'stop-todo-continuation',
    ];
    const icons = names.map((name) =>
      renderToStaticMarkup(<CapabilitiesPluginIcon name={name} />));

    names.forEach((name, index) => expect(icons[index]).toContain(`data-plugin-icon="${name}"`));
    expect(new Set(icons).size).toBe(names.length);
  });
});
