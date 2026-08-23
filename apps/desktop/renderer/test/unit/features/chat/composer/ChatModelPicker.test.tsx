// @vitest-environment happy-dom

import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatModelPicker } from '../../../../../src/features/chat/composer/ChatModelPicker.js';

vi.mock('antd', () => ({
  Button: ({ children, className, disabled, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" className={className} disabled={disabled} onClick={onClick}>{children}</button>
  ),
  Input: ({ onChange, placeholder, value }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input onChange={onChange} placeholder={placeholder} value={value} />
  ),
  Progress: () => <span data-component="progress" />,
  Tooltip: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('../../../../../src/shared/branding/BrandIconMark.js', () => ({
  BrandIconMark: () => <span data-component="brand" />,
}));

vi.mock('../../../../../src/shared/i18n/I18nProvider.js', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

describe('ChatModelPicker model scope', () => {
  it('changes the displayed and selected model for the current conversation', async () => {
    const config = runtimeConfig('provider-a');
    const providerA = config.providers[0]!;
    const modelA = providerA.models[0]!;
    const onSelect = vi.fn();
    const view = render(
      <ChatModelPicker
        config={config}
        model={modelA}
        openSignal={1}
        onSelect={onSelect}
        provider={providerA}
      />,
    );

    expect(await screen.findByRole('listbox', {
      name: 'chat.model.dialog',
    })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Model A' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Model A/ }).getAttribute('aria-selected')).toBe('true');

    fireEvent.mouseDown(screen.getByRole('option', { name: /Model B/ }));
    expect(onSelect).toHaveBeenCalledWith('provider-b', 'model-b');
    expect(screen.queryByRole('listbox')).toBeNull();

    const updatedConfig = runtimeConfig('provider-b');
    const providerB = updatedConfig.providers[1]!;
    const modelB = providerB.models[0]!;
    view.rerender(
      <ChatModelPicker
        config={updatedConfig}
        model={modelB}
        openSignal={2}
        onSelect={onSelect}
        provider={providerB}
      />,
    );

    expect(await screen.findByRole('listbox', {
      name: 'chat.model.dialog',
    })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Model B' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Model B/ }).getAttribute('aria-selected')).toBe('true');
  });
});

function runtimeConfig(activeProviderId: 'provider-a' | 'provider-b'): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/data',
    storagePath: '/tmp/storage',
    activeProviderId,
    providers: [
      provider('provider-a', 'Model A', 'anthropic', activeProviderId === 'provider-a'),
      provider('provider-b', 'Model B', 'openai-responses', activeProviderId === 'provider-b'),
    ],
    globalPrompt: '',
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
  };
}

function provider(
  id: 'provider-a' | 'provider-b',
  modelName: 'Model A' | 'Model B',
  kind: 'anthropic' | 'openai-responses',
  selected: boolean,
): RuntimeConfigState['providers'][number] {
  const suffix = id.at(-1)!;
  return {
    id,
    name: `Provider ${suffix.toUpperCase()}`,
    provider: kind,
    baseUrl: `https://${id}.example.test`,
    enabled: true,
    apiKeySet: true,
    apiKeyPreview: '***',
    models: [{
      id: `model-${suffix}`,
      name: modelName,
      code: `model-${suffix}-code`,
      enabled: selected,
      maxOutputTokens: 4_096,
      thinkingEnabled: false,
      thinkingEfforts: [],
    }],
  };
}
