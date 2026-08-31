// @vitest-environment happy-dom

import { parseRuntimePluginUiManifest } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeclarativePluginUiView } from '../../../../src/kernel/declarative-plugin-ui/DeclarativePluginUiView.js';

describe('DeclarativePluginUiView', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hydrates, confirms, saves, and rehydrates state through the bounded host contract', async () => {
    const manifest = parseRuntimePluginUiManifest({
      schemaVersion: 1,
      actions: [{ id: 'profile.save', approval: { message: 'Save profile?' } }],
      contributions: [{
        id: 'profile.settings',
        slot: 'renderer.capabilities.plugin.details',
        stateKey: 'profile',
        tree: {
          type: 'stack',
          children: [
            { type: 'field', name: 'displayName', label: 'Display name', required: true },
            { type: 'button', actionId: 'profile.save', label: 'Save' },
          ],
        },
      }],
    });
    const readRendererUiState = vi.fn()
      .mockResolvedValueOnce({ values: { displayName: 'Persisted' } })
      .mockResolvedValueOnce({ values: { displayName: 'Canonical' } });
    const runRendererUiAction = vi.fn(async () => ({ status: 'completed' as const }));

    render(
      <DeclarativePluginUiView
        contribution={manifest.contributions[0]}
        manifest={manifest}
        pluginId="plugin.demo"
        service={{ readRendererUiState, runRendererUiAction } as unknown as PluginManagementRendererService}
        translate={translate}
      />,
    );
    await screen.findByDisplayValue('Persisted');
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Setsuna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Save profile?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(runRendererUiAction).toHaveBeenCalledWith({
      actionId: 'profile.save',
      context: {
        contributionId: 'profile.settings',
        surface: 'renderer.capabilities.plugin.details',
      },
      pluginId: 'plugin.demo',
      values: { displayName: 'Setsuna' },
    }, { signal: expect.any(AbortSignal) }));
    await screen.findByDisplayValue('Canonical');
    expect(readRendererUiState).toHaveBeenCalledTimes(2);
  });
});

const translations = {
  'feature.pluginManagement.rendererUi.actionError': 'Action failed',
  'feature.pluginManagement.rendererUi.approvalTitle': 'Confirm plugin action',
  'feature.pluginManagement.rendererUi.cancel': 'Cancel',
  'feature.pluginManagement.rendererUi.completed': 'Action completed',
  'feature.pluginManagement.rendererUi.confirm': 'Confirm',
  'feature.pluginManagement.rendererUi.loading': 'Loading',
  'feature.pluginManagement.rendererUi.requiredError': 'Required',
  'feature.pluginManagement.rendererUi.stateError': 'State failed',
  'feature.pluginManagement.rendererUi.working': 'Working',
} as const;

const translate: RendererTranslate = (key) => translations[key as keyof typeof translations] ?? key;
