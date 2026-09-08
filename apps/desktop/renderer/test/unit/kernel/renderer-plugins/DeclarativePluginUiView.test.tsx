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
    const runRendererUiAction = vi.fn(async (
      ..._args: Parameters<PluginManagementRendererService['runRendererUiAction']>
    ) => ({ status: 'completed' as const }));
    const contribution = manifest.contributions[0];
    if (!contribution?.tree) throw new Error('Expected a declarative contribution.');

    render(
      <DeclarativePluginUiView
        contribution={contribution}
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

  it('binds project-scoped Plugin state and refreshes it after an action', async () => {
    const manifest = parseRuntimePluginUiManifest({
      schemaVersion: 2,
      actions: [{ id: 'release.run', approval: { message: 'Run checks?' } }],
      contributions: [{
        id: 'release.page',
        slot: 'renderer.plugin.page',
        navigation: { label: 'Release checker', badge: { path: 'summary.label' } },
        data: { stateKey: 'release.view', scope: 'project' },
        tree: {
          type: 'stack',
          children: [
            { type: 'text', text: { path: 'summary.label', fallback: 'Not run' } },
            { type: 'field', name: 'command', label: 'Command', defaultValue: { path: 'config.command' } },
            { type: 'button', actionId: 'release.run', label: 'Run checks' },
          ],
        },
      }],
    });
    const readRendererUiData = vi.fn()
      .mockResolvedValueOnce({ data: { config: { command: 'pnpm test' }, summary: { label: 'Pending' } } })
      .mockResolvedValueOnce({ data: { config: { command: 'pnpm test' }, summary: { label: 'Ready' } } });
    const runRendererUiAction = vi.fn(async (
      ..._args: Parameters<PluginManagementRendererService['runRendererUiAction']>
    ) => ({ status: 'completed' as const }));
    let dataListener: () => void = () => undefined;
    const service = {
      readRendererUiData,
      runRendererUiAction: vi.fn(async (...args: Parameters<typeof runRendererUiAction>) => {
        const result = await runRendererUiAction(...args);
        dataListener();
        return result;
      }),
      subscribe: () => () => undefined,
      subscribeRendererUiData: (_pluginId: string, listener: () => void) => {
        dataListener = listener;
        return () => { dataListener = () => undefined; };
      },
    } as unknown as PluginManagementRendererService;
    const contribution = manifest.contributions[0];
    if (!contribution?.tree) throw new Error('Expected a declarative contribution.');

    render(
      <DeclarativePluginUiView
        contribution={contribution}
        cwd="/workspace/demo"
        manifest={manifest}
        pluginId="release-checker"
        projectId="project_1"
        service={service}
        translate={translate}
      />,
    );

    await waitFor(() => expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('pnpm test'));
    expect(screen.getByText('Pending')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run checks' }));
    expect(screen.getByText('Run checks?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(runRendererUiAction).toHaveBeenCalledWith({
      actionId: 'release.run',
      context: {
        contributionId: 'release.page',
        cwd: '/workspace/demo',
        projectId: 'project_1',
        surface: 'renderer.plugin.page',
      },
      pluginId: 'release-checker',
      values: { command: 'pnpm test' },
    }, { signal: expect.any(AbortSignal) }));
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy());
    expect(readRendererUiData).toHaveBeenCalledTimes(2);
  });

  it('isolates form drafts and running actions when the project scope changes', async () => {
    const manifest = parseRuntimePluginUiManifest({
      schemaVersion: 2,
      actions: [{ id: 'release.run', approval: { message: 'Run checks?' } }],
      contributions: [{
        id: 'release.page',
        slot: 'renderer.plugin.page',
        navigation: { label: 'Release checker' },
        tree: {
          type: 'stack',
          children: [
            { type: 'field', name: 'command', label: 'Scoped command', defaultValue: 'pnpm test' },
            { type: 'button', actionId: 'release.run', label: 'Run scoped checks' },
          ],
        },
      }],
    });
    const contribution = manifest.contributions[0];
    if (!contribution?.tree) throw new Error('Expected a declarative contribution.');
    let runningSignal: AbortSignal | undefined;
    const runRendererUiAction = vi.fn((
      ...args: Parameters<PluginManagementRendererService['runRendererUiAction']>
    ) => new Promise<{ status: 'completed' }>((resolve) => {
      runningSignal = args[1]?.signal;
      runningSignal?.addEventListener('abort', () => resolve({ status: 'completed' }), { once: true });
    }));
    const service = {
      runRendererUiAction,
    } as unknown as PluginManagementRendererService;
    const view = (projectId: string) => (
      <DeclarativePluginUiView
        contribution={contribution}
        manifest={manifest}
        pluginId="release-checker"
        projectId={projectId}
        service={service}
        translate={translate}
      />
    );
    const { getByLabelText, getByRole, rerender } = render(view('project_1'));

    fireEvent.change(getByLabelText('Scoped command'), { target: { value: 'project-a-command' } });
    fireEvent.click(getByRole('button', { name: 'Run scoped checks' }));
    fireEvent.click(getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(runRendererUiAction).toHaveBeenCalledTimes(1));

    rerender(view('project_2'));

    expect((getByLabelText('Scoped command') as HTMLInputElement).value).toBe('pnpm test');
    await waitFor(() => expect(runningSignal?.aborted).toBe(true));
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
