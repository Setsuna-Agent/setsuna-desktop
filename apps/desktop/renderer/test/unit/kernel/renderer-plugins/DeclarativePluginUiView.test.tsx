// @vitest-environment happy-dom

import { parseRuntimePluginUiManifest } from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeclarativePluginUiView } from '../../../../src/kernel/declarative-plugin-ui/DeclarativePluginUiView.js';

describe('DeclarativePluginUiView', () => {
  afterEach(() => vi.restoreAllMocks());

  it('submits host-owned values with the exact contribution identity', async () => {
    const manifest = parseRuntimePluginUiManifest({
      schemaVersion: 1,
      actions: [{ id: 'profile.save', approval: { message: 'Save profile?' } }],
      contributions: [{
        id: 'profile.settings',
        slot: 'renderer.settings.page.extensions',
        target: 'general',
        tree: {
          type: 'stack',
          children: [
            { type: 'field', name: 'displayName', label: 'Display name', required: true },
            { type: 'button', actionId: 'profile.save', label: 'Save' },
          ],
        },
      }],
    });
    const runRendererUiAction = vi.fn(async () => ({ status: 'completed' as const }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <DeclarativePluginUiView
        contributionId="profile.settings"
        manifest={manifest}
        node={manifest.contributions[0].tree}
        pluginId="plugin.demo"
        service={{ runRendererUiAction } as unknown as PluginManagementRendererService}
        slot="renderer.settings.page.extensions"
      />,
    );
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Setsuna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(runRendererUiAction).toHaveBeenCalledWith({
      actionId: 'profile.save',
      context: {
        contributionId: 'profile.settings',
        surface: 'renderer.settings.page.extensions',
      },
      pluginId: 'plugin.demo',
      values: { displayName: 'Setsuna' },
    }));
  });
});
