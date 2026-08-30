import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  filterRendererPluginInspection,
  RendererPluginInspectorSettings,
} from '../../../../src/composition/renderer-plugins/RendererPluginInspectorSettings.js';
import { settingsViewUi } from '../../../../src/shared/ui/SettingsViewUi.js';

const useRendererPluginInspection = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/kernel/renderer-plugins/RendererKernelProvider.js', () => ({
  useRendererPluginInspection,
}));

describe('RendererPluginInspectorSettings filtering', () => {
  it('includes unreachable registrations in dormant filtering and search', () => {
    const inspection = {
      dormant: [{
        entryId: 'feature.detached.panel',
        owner: { pluginId: 'feature.detached', scopeId: 'feature:detached:0' },
        slotId: 'renderer.workspace.panel',
        state: 'dormant' as const,
      }],
      roots: [],
    };

    expect(filterRendererPluginInspection(inspection, '', 'dormant').dormant).toEqual(
      inspection.dormant,
    );
    expect(filterRendererPluginInspection(inspection, 'workspace.panel', 'all').dormant).toEqual(
      inspection.dormant,
    );
    expect(filterRendererPluginInspection(inspection, '', 'active').dormant).toEqual([]);
  });

  it('keeps diagnostics collapsed and compacts multi-entry Slot summaries', () => {
    useRendererPluginInspection.mockReturnValue({
      dormant: [],
      renderErrors: [],
      roots: [{
        activeEntryIds: ['settings.general', 'settings.runtime'],
        candidates: [],
        children: [],
        declaredBy: { pluginId: 'shell', scopeId: 'shell:0' },
        defaultActiveEntryIds: ['settings.general', 'settings.runtime'],
        kind: 'keyed',
        path: 'renderer.settings.page',
        required: true,
        requiredKeys: ['settings/general', 'settings/runtime'],
        slotId: 'renderer.settings.page',
      }],
      snapshotVersion: 1,
      stalePreferences: [],
    });

    const html = renderToStaticMarkup(createElement(RendererPluginInspectorSettings, {
      translate,
      ui: settingsViewUi,
    }));
    const entrySummary = html.match(
      /<summary class="renderer-plugin-inspector__entry-summary">([\s\S]*?)<\/summary>/,
    )?.[1].replace(/<[^>]+>/g, '');

    expect(html).toContain(
      '<details class="chat-user-settings__section-block chat-user-settings__advanced-disclosure renderer-plugin-inspector">',
    );
    expect(entrySummary).toContain('2 active entries');
    expect(entrySummary).not.toContain('settings.general');
    expect(entrySummary).not.toContain('settings.runtime');
  });
});

const translate: RendererTranslate = (key, params) => {
  if (key === 'feature.rendererInspector.activeCount') return `${params?.count} active entries`;
  return key;
};
