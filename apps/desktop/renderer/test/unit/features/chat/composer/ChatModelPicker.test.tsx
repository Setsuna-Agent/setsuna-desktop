// @vitest-environment happy-dom

import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatModelPicker } from '../../../../../src/features/chat/composer/ChatModelPicker.js';
import { useChatComposerModeController } from '../../../../../src/features/chat/composer/useChatComposerModeController.js';
import type { ChatComposerSendOptions } from '../../../../../src/features/chat/composer/chatComposerSendOptions.js';
import type { ChatThinkingControl } from '../../../../../src/features/chat/composer/chatThinkingMenu.js';

vi.mock('../../../../../src/shared/branding/BrandIconMark.js', () => ({
  BrandIconMark: () => <span />,
}));

vi.mock('../../../../../src/shared/i18n/I18nProvider.js', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const noThinking: ChatThinkingControl = {
  config: { supported: false, efforts: [], defaultEffort: '' },
  disabled: false,
  enabled: false,
  effort: '',
  onEffortChange: () => undefined,
  onEnabledChange: () => undefined,
};

describe('ChatModelPicker model and thinking selection', () => {
  it('opens and searches the model submenu entirely with the keyboard, including returning from the list', async () => {
    const user = userEvent.setup({ skipHover: true });
    const config = runtimeConfig('provider-a');
    const onSelect = vi.fn();
    const view = render(
      <ChatModelPicker config={config} model={config.providers[0]!.models[0]!}
        provider={config.providers[0]!} onSelect={onSelect} thinkingControl={noThinking} />,
    );
    screen.getByRole('button', { name: 'Model A' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^chat.model.label/ })));
    await user.keyboard('{ArrowRight}');
    const search = await screen.findByRole('textbox', { name: 'chat.model.search' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.keyboard('Model B');
    expect(screen.queryByRole('menuitem', { name: 'Model A' })).toBeNull();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Model B' }));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(search);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Model B' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(search);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('provider-b', 'model-b');
    expect(screen.getByRole('menuitem', { name: /^chat.model.label/ })).toBeTruthy();

    view.rerender(
      <ChatModelPicker config={config} model={config.providers[1]!.models[0]!}
        provider={config.providers[1]!} onSelect={onSelect} thinkingControl={noThinking} />,
    );
    expect(screen.getByRole('button', { name: 'Model B' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Model B' }));
  });

  it('keeps an empty search editable and does not select a model while confirming IME input', async () => {
    const user = userEvent.setup({ skipHover: true });
    const config = runtimeConfig('provider-a');
    const onSelect = vi.fn();
    render(<ChatModelPicker config={config} model={config.providers[0]!.models[0]!}
      provider={config.providers[0]!} onSelect={onSelect} thinkingControl={noThinking} />);
    screen.getByRole('button', { name: 'Model A' }).focus();
    await user.keyboard('{Enter}{ArrowRight}');
    const search = await screen.findByRole('textbox', { name: 'chat.model.search' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.keyboard('no matching model{ArrowDown}{Tab}');
    expect(document.activeElement).toBe(search);
    expect(onSelect).not.toHaveBeenCalled();

    await user.keyboard('{Control>}a{/Control}Model B');
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
    expect(onSelect).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Model B' }));
    await user.tab();
    expect(document.activeElement).toBe(search);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('sends the selected effort and restores independent thinking preferences when switching models', async () => {
    const user = userEvent.setup({ skipHover: true });
    const config = runtimeConfig('provider-a');
    Object.assign(config.providers[0]!.models[0]!, { thinkingEnabled: true, thinkingEfforts: ['low', 'high'], defaultThinkingEffort: 'low' });
    Object.assign(config.providers[1]!.models[0]!, { thinkingEnabled: true, thinkingEfforts: ['medium', 'max'], defaultThinkingEffort: 'medium' });
    const onSend = vi.fn();
    render(<ThinkingHarness config={config} onSend={onSend} />);

    await user.click(screen.getByRole('button', { name: /^Model A/ }));
    await user.click(screen.getByRole('menuitem', { name: 'High' }));
    await user.click(screen.getByRole('button', { name: 'send options' }));
    expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ thinking: true, thinkingEffort: 'high' }));

    await user.click(screen.getByRole('button', { name: /^Model A/ }));
    await user.click(screen.getByRole('menuitem', { name: /^chat.model.label/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Model B' }));
    expect(screen.queryByRole('menuitem', { name: 'High' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Max' }));
    await user.click(screen.getByRole('button', { name: 'send options' }));
    expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ thinking: true, thinkingEffort: 'max' }));

    await user.click(screen.getByRole('button', { name: /^Model B/ }));
    await user.click(screen.getByRole('menuitem', { name: /^chat.model.label/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Model A' }));
    // Selecting a model must restore its own effort before the next send.
    fireEvent.click(screen.getByRole('button', { name: 'send options' }));
    expect(onSend).toHaveBeenLastCalledWith(expect.objectContaining({ thinking: true, thinkingEffort: 'high' }));
    await user.click(screen.getByRole('menuitem', { name: 'chat.composer.thinkingOff' }));
    await user.click(screen.getByRole('button', { name: 'send options' }));
    expect(onSend.mock.lastCall?.[0]).toMatchObject({ thinking: false });
    expect(onSend.mock.lastCall?.[0]).not.toHaveProperty('thinkingEffort');
  });

  it('supports thinking without effort levels and respects the editing lock', async () => {
    const user = userEvent.setup({ skipHover: true });
    const config = runtimeConfig('provider-a');
    config.providers[0]!.models[0]!.thinkingEnabled = true;
    const onSend = vi.fn();
    const view = render(<ThinkingHarness config={config} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: /^Model A/ }));
    await user.click(screen.getByRole('menuitem', { name: 'chat.composer.thinkingOn' }));
    await user.click(screen.getByRole('button', { name: 'send options' }));
    expect(onSend.mock.lastCall?.[0]).toMatchObject({ thinking: true });
    expect(onSend.mock.lastCall?.[0]).not.toHaveProperty('thinkingEffort');

    view.rerender(<ThinkingHarness config={config} onSend={onSend} thinkingDisabled />);
    await user.click(screen.getByRole('button', { name: /^Model A/ }));
    await user.click(screen.getByRole('menuitem', { name: 'chat.composer.thinkingOff' }));
    fireEvent.click(screen.getByRole('button', { name: 'send options' }));
    expect(onSend.mock.lastCall?.[0]).toMatchObject({ thinking: true });
  });
});

function ThinkingHarness({ config, onSend, thinkingDisabled = false }: {
  config: RuntimeConfigState;
  onSend: (options: ChatComposerSendOptions) => void;
  thinkingDisabled?: boolean;
}) {
  const [providerId, setProviderId] = useState(config.providers[0]!.id);
  const provider = config.providers.find((item) => item.id === providerId)!;
  const model = provider.models[0]!;
  const controller = useChatComposerModeController({ model, provider });
  return <>
    <ChatModelPicker config={config} model={model} provider={provider} onSelect={(id) => setProviderId(id)}
      thinkingControl={{
        config: controller.thinkingConfig,
        disabled: thinkingDisabled,
        enabled: controller.thinkingEnabled,
        effort: controller.thinkingEffort,
        onEffortChange: controller.setThinkingEffort,
        onEnabledChange: controller.setThinkingEnabled,
      }} />
    <button onClick={() => onSend(controller.createSendOptions({ attachments: [], selectedSkillIds: [], selectedSkillReferences: [] }))}>send options</button>
  </>;
}

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
