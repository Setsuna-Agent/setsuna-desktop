import { describe, expect, it } from 'vitest';
import {
  filterRendererPluginInspection,
} from '../../../../src/composition/renderer-plugins/RendererPluginInspectorSettings.js';

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
});
