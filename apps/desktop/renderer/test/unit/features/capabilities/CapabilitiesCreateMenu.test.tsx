// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilitiesPluginCreateMenu } from '../../../../src/features/capabilities/CapabilitiesCreateMenu.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('plugin create menu', () => {
  it('offers AI creation and local import from the shared create popover', async () => {
    const onCreateInConversation = vi.fn();
    const onImport = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <I18nProvider initialLocale="zh-CN">
        <CapabilitiesPluginCreateMenu
          importing={false}
          open
          onCreateInConversation={onCreateInConversation}
          onImport={onImport}
          onOpenChange={onOpenChange}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('button', { name: '创建' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('告诉 AI 需要的能力并创建可安装插件。')).toBeTruthy();
    expect(screen.getByText('选择一个已经准备好的 Plugin Bundle 目录。')).toBeTruthy();

    await userEvent.click(screen.getByRole('menuitem', { name: /用对话创建插件/u }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreateInConversation).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('menuitem', { name: /导入本地插件/u }));
    expect(onImport).toHaveBeenCalledOnce();
  });

  it('exposes import progress on the create trigger', () => {
    render(
      <I18nProvider initialLocale="zh-CN">
        <CapabilitiesPluginCreateMenu
          importing
          open={false}
          onCreateInConversation={() => undefined}
          onImport={() => undefined}
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    const trigger = screen.getByRole('button', { name: '正在导入' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute('aria-busy')).toBe('true');
  });
});
