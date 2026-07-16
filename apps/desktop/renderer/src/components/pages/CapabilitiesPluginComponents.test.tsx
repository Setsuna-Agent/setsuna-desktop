import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CapabilitiesPluginCard } from './CapabilitiesPluginCard.js';
import { CapabilitiesPluginMarketCard } from './CapabilitiesPluginMarketCard.js';

describe('capabilities plugin components', () => {
  it('renders installed capability ownership and a safe uninstall action', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginCard
        plugin={{
          id: 'demo',
          name: 'Demo Plugin',
          version: '1.2.3',
          description: 'Local plugin fixture',
          publisher: 'Setsuna',
          tags: ['文档'],
          installedAt: '2026-07-15T00:00:00.000Z',
          skills: [{ id: 'demo.docs', name: 'Docs' }],
          mcpServers: [{ key: 'demo_docs', owned: true }],
          hookCount: 1,
          resources: [{ id: 'guide', label: 'Guide', path: 'resources/guide.md', size: 8 }],
        }}
        removing={false}
        onRemove={async () => undefined}
      />,
    );

    expect(html).toContain('Demo Plugin');
    expect(html).toContain('1 个技能');
    expect(html).toContain('1 个服务连接');
    expect(html).toContain('1 项自动化');
    expect(html).toContain('卸载');
  });

  it('renders a one-click marketplace card without asking for a local path', () => {
    const html = renderToStaticMarkup(
      <CapabilitiesPluginMarketCard
        plugin={{
          id: 'openai-docs',
          name: 'OpenAI 官方文档',
          version: '1.0.0',
          description: '查询最新官方开发文档。',
          publisher: 'OpenAI',
          tags: ['官方', '开发文档'],
          featured: true,
          capabilities: { skills: 1, mcpServers: 1, hooks: 0, resources: 0 },
          installed: false,
        }}
        installing={false}
        onInstall={async () => undefined}
      />,
    );

    expect(html).toContain('OpenAI 官方文档');
    expect(html).toContain('1 个技能');
    expect(html).toContain('1 个服务连接');
    expect(html).toContain('安装');
    expect(html).not.toContain('目录');
    expect(html).not.toContain('plugin.json');
  });
});
