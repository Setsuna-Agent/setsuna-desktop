// @vitest-environment happy-dom

import type { ProviderModelConfig } from '@setsuna-desktop/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderModelSettingsDialog } from '../../../../src/features/settings/providers/ProviderModelSettingsDialog.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

const model: ProviderModelConfig = {
  id: 'model-1',
  name: 'Model',
  code: 'model-1',
  enabled: true,
  maxOutputTokens: 68_000,
  thinkingEnabled: true,
  thinkingEfforts: ['xhigh'],
  defaultThinkingEffort: 'xhigh',
  supportsImages: false,
};

function renderDialog(onConfirm: (confirmedModel: ProviderModelConfig) => void) {
  render(
    <I18nProvider initialLocale="zh-CN">
      <ProviderModelSettingsDialog
        defaultMaxOutputTokens={68_000}
        model={model}
        onClose={() => undefined}
        onConfirm={onConfirm}
      />
    </I18nProvider>,
  );
}

describe('ProviderModelSettingsDialog', () => {
  it('creates and selects a custom thinking effort when Enter is pressed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderDialog(onConfirm);

    const customEffortInput = screen.getByRole('textbox', { name: '自定义思考等级' }) as HTMLInputElement;
    await user.type(customEffortInput, 'ultra{Enter}');

    const customEffort = screen.getByRole('button', { name: 'ultra' });
    expect(customEffort.getAttribute('aria-pressed')).toBe('true');
    expect(customEffortInput.value).toBe('');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('includes a pending custom thinking effort when Confirm is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderDialog(onConfirm);

    await user.type(screen.getByRole('textbox', { name: '自定义思考等级' }), 'ultra');
    await user.click(screen.getByRole('button', { name: '确定' }));

    expect(onConfirm).toHaveBeenCalledWith({
      ...model,
      thinkingEfforts: ['xhigh', 'ultra'],
    });
  });
});
