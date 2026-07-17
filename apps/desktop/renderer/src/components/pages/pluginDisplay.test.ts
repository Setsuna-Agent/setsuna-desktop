import { describe, expect, it } from 'vitest';
import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { mergePluginHooks, mergePluginMcpServers, mergePluginSkills, pluginCapabilitySummary, pluginMarketplacePresentation, pluginMatchesQuery } from './pluginDisplay.js';

describe('plugin display helpers', () => {
  it('matches plugin searches against included skill and MCP details', () => {
    const plugin = {
      name: 'Developer Docs',
      skills: [{ name: 'Library Guide', description: 'Version-aware examples' }],
      mcpServers: [{ label: 'Context Service', description: 'Current framework documentation' }],
      hooks: [{ name: 'Danger guard', description: 'Blocks destructive commands', eventName: 'PreToolUse' as const }],
    };

    expect(pluginMatchesQuery(plugin, 'version-aware')).toBe(true);
    expect(pluginMatchesQuery(plugin, 'context service')).toBe(true);
    expect(pluginMatchesQuery(plugin, 'destructive commands')).toBe(true);
    expect(pluginMatchesQuery(plugin, 'spreadsheet')).toBe(false);
  });

  it('keeps marketplace descriptions while adding installed MCP ownership', () => {
    expect(mergePluginSkills(
      [{ id: 'demo.docs', name: 'Docs', description: 'Marketplace description' }],
      [{ id: 'demo.docs', name: 'Docs' }],
    )).toEqual([{ id: 'demo.docs', name: 'Docs', description: 'Marketplace description' }]);

    expect(mergePluginMcpServers(
      [{ key: 'docs', label: 'Docs MCP', description: 'Marketplace MCP', transport: 'streamableHttp' }],
      [{ key: 'docs', label: 'Docs MCP', transport: 'streamableHttp', owned: false }],
    )).toEqual([{
      key: 'docs',
      label: 'Docs MCP',
      description: 'Marketplace MCP',
      transport: 'streamableHttp',
      owned: false,
    }]);

    expect(mergePluginHooks(
      [{ id: 'audit', name: 'Audit', description: 'Marketplace Hook', eventName: 'PostToolUse' }],
      [{ id: 'audit', name: 'Audit', eventName: 'PostToolUse', statusMessage: 'Running audit' }],
    )).toEqual([{
      id: 'audit',
      name: 'Audit',
      description: 'Marketplace Hook',
      eventName: 'PostToolUse',
      statusMessage: 'Running audit',
    }]);
  });

  it('builds editorial and App Store-style list sections without hiding featured plugins', () => {
    const openAi = marketplacePlugin({ id: 'openai-docs', name: 'OpenAI Docs', featured: true });
    const pdf = marketplacePlugin({ id: 'pdf', name: 'PDF', featured: true });
    const context = marketplacePlugin({ id: 'context7', name: 'Context7' });
    const guard = marketplacePlugin({
      id: 'guard',
      name: 'Guard',
      capabilities: { skills: 0, mcpServers: 0, hooks: 1, resources: 0 },
    });

    const presentation = pluginMarketplacePresentation([openAi, pdf, context, guard], false);

    expect(presentation.editorials.map((plugin) => plugin.id)).toEqual(['openai-docs', 'pdf']);
    expect(presentation.sections).toMatchObject([
      { id: 'creation', plugins: [{ id: 'openai-docs' }, { id: 'pdf' }, { id: 'context7' }] },
      { id: 'automation', plugins: [{ id: 'guard' }] },
    ]);
    expect(pluginCapabilitySummary(guard)).toBe('1 项自动化');
  });

  it('turns a marketplace search into one result section without editorials', () => {
    const result = pluginMarketplacePresentation([
      marketplacePlugin({ id: 'pdf', name: 'PDF', featured: true }),
    ], true);

    expect(result.editorials).toEqual([]);
    expect(result.sections).toMatchObject([{
      id: 'results',
      title: '搜索结果',
      plugins: [{ id: 'pdf' }],
    }]);
  });
});

function marketplacePlugin(
  input: Pick<RuntimePluginMarketplaceItem, 'id' | 'name'> & Partial<RuntimePluginMarketplaceItem>,
): RuntimePluginMarketplaceItem {
  return {
    tags: [],
    featured: false,
    skills: [],
    mcpServers: [],
    hooks: [],
    capabilities: { skills: 1, mcpServers: 0, hooks: 0, resources: 0 },
    installed: false,
    ...input,
  };
}
