import { describe, expect, it } from 'vitest';
import { mergePluginHooks, mergePluginMcpServers, mergePluginSkills, pluginMatchesQuery } from './pluginDisplay.js';

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
});
