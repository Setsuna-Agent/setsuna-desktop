import type { RuntimePluginMarketplaceItem } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  formatPluginFileSize,
  mergePluginHooks,
  mergePluginMcpServers,
  mergePluginSkills,
  pluginCapabilitySummary,
  pluginMarketplacePresentation,
} from '../../../../src/features/capabilities/pluginDisplay.js';
import { translate, type Translate } from '../../../../src/shared/i18n/I18nProvider.js';

const en: Translate = (key, params) => translate('en-US', key, params);

describe('plugin display helpers', () => {
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

  it('formats plugin file sizes for compact detail metadata', () => {
    expect(formatPluginFileSize(512)).toBe('512 B');
    expect(formatPluginFileSize(2048)).toBe('2.0 KB');
    expect(formatPluginFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('builds a featured section and keeps the remaining catalog grouped by capability', () => {
    const documents = marketplacePlugin({ id: 'documents', name: 'Word', featured: true });
    const pdf = marketplacePlugin({ id: 'pdf', name: 'PDF', featured: true });
    const openAi = marketplacePlugin({ id: 'openai-docs', name: 'OpenAI Docs' });
    const context = marketplacePlugin({ id: 'context7', name: 'Context7' });
    const guard = marketplacePlugin({
      id: 'guard',
      name: 'Guard',
      capabilities: { skills: 0, mcpServers: 0, hooks: 1, resources: 0 },
    });

    const presentation = pluginMarketplacePresentation([documents, pdf, openAi, context, guard]);

    expect(presentation.sections).toMatchObject([
      { id: 'featured', plugins: [{ id: 'documents' }, { id: 'pdf' }] },
      { id: 'creation', plugins: [{ id: 'openai-docs' }, { id: 'context7' }] },
      { id: 'automation', plugins: [{ id: 'guard' }] },
    ]);
    expect(pluginCapabilitySummary(guard)).toBe('1 项自动化');
  });

  it('builds marketplace section copy and capability counts in English', () => {
    const documents = marketplacePlugin({ id: 'documents', name: 'Word', featured: true });
    const guard = marketplacePlugin({
      id: 'guard',
      name: 'Guard',
      capabilities: { skills: 0, mcpServers: 0, hooks: 2, resources: 0 },
    });
    const presentation = pluginMarketplacePresentation([documents, guard], en);

    expect(presentation.sections).toMatchObject([
      { title: 'Featured', description: 'A few Setsuna plugins worth trying first' },
      { title: 'Safety & automation', description: 'Local hook workflows you can install as needed' },
    ]);
    expect(pluginCapabilitySummary(documents, en)).toBe('1 skill');
    expect(pluginCapabilitySummary(guard, en)).toBe('2 automations');
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
    resources: [],
    capabilities: { skills: 1, mcpServers: 0, hooks: 0, resources: 0 },
    installed: false,
    updateAvailable: false,
    ...input,
  };
}
