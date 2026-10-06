// @vitest-environment happy-dom

import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { useModelProviderSnapshot } from '@setsuna-desktop/feature-model-provider/renderer';
import type { VisionRecognitionSettingsState } from '@setsuna-desktop/feature-vision-recognition/contracts';
import { VisionRecognitionSettingsView, type VisionRecognitionClient } from '@setsuna-desktop/feature-vision-recognition/renderer';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { settingsViewUi } from '../../../src/shared/ui/SettingsViewUi.js';

vi.mock('@setsuna-desktop/feature-model-provider/renderer', async (importOriginal) => ({
  ...await importOriginal<typeof import('@setsuna-desktop/feature-model-provider/renderer')>(),
  useModelProviderSnapshot: vi.fn(),
}));
vi.mock('../../../src/shared/i18n/I18nProvider.js', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../../src/shared/branding/BrandIconMark.js', () => ({ BrandIconMark: () => <span /> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('keeps vision choices restricted to runtime availability and saves selection and clearing with the latest revision', async () => {
  const providers = [provider('a', 'Alpha service', 'Alpha vision', 'alpha-code'), provider('b', 'Beta service', 'Beta vision', 'beta-code')];
  providers[0]!.models.push({ ...providers[0]!.models[0]!, id: 'text', name: 'Text only', code: 'text-code', supportsImages: false });
  vi.mocked(useModelProviderSnapshot).mockReturnValue({
    state: { activeProviderId: 'a', providers },
    error: null, loading: false, catalog: null, refreshingCatalogProviderId: null, catalogError: null, proxyServers: [],
  });
  let state: VisionRecognitionSettingsState = {
    selection: null, revision: 3, appliedRevision: null, health: 'not-configured',
    availableModels: providers.map((provider) => ({
      providerId: provider.id, providerName: provider.name,
      modelId: provider.models[0]!.id, modelName: provider.models[0]!.name, modelCode: provider.models[0]!.code,
    })),
  };
  const client: VisionRecognitionClient = {
    readSettings: vi.fn(async () => state),
    updateSettings: vi.fn(async (input) => {
      expect(input.expectedRevision).toBe(state.revision);
      state = { ...state, selection: input.selection, revision: state.revision + 1, health: input.selection ? 'ready' : 'not-configured' };
      return state;
    }),
    testModel: vi.fn(),
  };
  const user = userEvent.setup({ skipHover: true });
  render(<VisionRecognitionSettingsView client={client} ui={settingsViewUi} translate={(key) => key} />);
  const trigger = screen.getByRole('button', { name: 'feature.visionRecognition.settings.model' });
  await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false));
  await user.click(trigger);
  const search = await screen.findByRole('textbox', { name: 'chat.model.search' });
  expect(screen.queryByRole('menuitem', { name: 'Text only' })).toBeNull();
  await user.type(search, ' BETA-CODE ');
  await user.keyboard('{Enter}');
  await waitFor(() => expect(client.updateSettings).toHaveBeenCalledWith({
    expectedRevision: 3, selection: { providerId: 'b', modelId: 'shared' },
  }));
  await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false));

  await user.click(trigger);
  expect((await screen.findByRole('textbox', { name: 'chat.model.search' }) as HTMLInputElement).value).toBe('');
  await user.click(screen.getByRole('menuitem', { name: 'feature.visionRecognition.settings.modelPlaceholder' }));
  await waitFor(() => expect(client.updateSettings).toHaveBeenLastCalledWith({ expectedRevision: 4, selection: null }));
  expect(client.updateSettings).toHaveBeenCalledTimes(2);
  expect(client.testModel).not.toHaveBeenCalled();
});

function provider(id: string, name: string, modelName: string, code: string): ProviderConfigState {
  return {
    id, name, provider: 'openai-compatible', baseUrl: 'https://example.test/v1', enabled: true, apiKeySet: true, apiKeyPreview: '***',
    models: [{ id: 'shared', name: modelName, code, supportsImages: true, enabled: false, maxOutputTokens: 4_096, thinkingEnabled: false, thinkingEfforts: [] }],
  };
}
