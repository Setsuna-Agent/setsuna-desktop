import type { RuntimePluginMarketplaceItem, RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  formatPluginFileSize,
  installedPluginsOutsideCatalog,
  mergePluginHooks,
  mergePluginMcpServers,
  mergePluginSkills,
  pluginCapabilitySummary,
  pluginMarketplacePresentation,
} from '../../../../src/features/capabilities/pluginDisplay.js';
import { translate, type Translate } from '../../../../src/shared/i18n/I18nProvider.js';

const en: Translate = (key, params) => translate('en-US', key, params);

describe('plugin display helpers', () => {
  it('keeps installed marketplace plugins reachable after they leave the catalog', () => {
    const current = installedPlugin({ id: 'current', installationSource: 'marketplace' });
    const orphaned = installedPlugin({ id: 'orphaned', installationSource: 'marketplace' });
    const local = installedPlugin({ id: 'local', installationSource: 'local' });

    expect(installedPluginsOutsideCatalog(
      [current, orphaned, local],
      [marketplacePlugin({ id: 'current', name: 'Current' })],
    ).map((plugin) => plugin.id)).toEqual(['orphaned', 'local']);
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
    const question = marketplacePlugin({
      id: 'pi-question',
      name: 'Structured Question',
      publisher: 'Setsuna',
      capabilities: { extension: 1, skills: 0, mcpServers: 0, hooks: 0, resources: 0 },
    });
    const guard = marketplacePlugin({
      id: 'guard',
      name: 'Guard',
      capabilities: { skills: 0, mcpServers: 0, hooks: 1, resources: 0 },
    });

    const presentation = pluginMarketplacePresentation([documents, pdf, question, openAi, context, guard]);

    expect(presentation.sections).toMatchObject([
      { id: 'featured', plugins: [{ id: 'documents' }, { id: 'pdf' }] },
      { id: 'utilities', plugins: [{ id: 'pi-question' }] },
      { id: 'creation', plugins: [{ id: 'openai-docs' }, { id: 'context7' }] },
      { id: 'automation', plugins: [{ id: 'guard' }] },
    ]);
    expect(pluginCapabilitySummary(guard)).toBe('1 项自动化');
    expect(pluginMarketplacePresentation([documents, guard], en).sections[0]?.title).toBe('Featured');
    expect(pluginMarketplacePresentation([question], en).sections[0]?.title).toBe('Tools & workflows');
    expect(pluginCapabilitySummary(guard, en)).toBe('1 automation');

    const worker = marketplacePlugin({
      id: 'worker',
      name: 'Worker',
      capabilities: { extension: 1, skills: 0, mcpServers: 0, hooks: 0, resources: 0 },
    });
    expect(pluginCapabilitySummary(worker, en)).toBe('Executable extension');
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

function installedPlugin(
  input: Pick<RuntimePluginSummary, 'id'> & Partial<RuntimePluginSummary>,
): RuntimePluginSummary {
  return {
    name: input.id,
    installedAt: '2026-08-09T00:00:00.000Z',
    skills: [],
    mcpServers: [],
    hooks: [],
    hookCount: 0,
    resources: [],
    ...input,
  };
}
