// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatStarter,
  ChatStarterContent,
} from '../../../../../src/features/chat/conversation/ChatStarter.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('ChatStarter', () => {
  it('sends a project suggestion through the real chat send handler', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(
      <I18nProvider initialLocale="zh-CN">
        <ChatStarter composer={<div>composer</div>}>
          <ChatStarterContent projectName="Setsuna" onSend={onSend} />
        </ChatStarter>
      </I18nProvider>,
    );

    const prompt = '快速了解 Setsuna 的结构和关键链路';
    await userEvent.click(screen.getByRole('button', { name: prompt }));

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith(prompt);
  });

  it('keeps the host composer outside replaceable starter content', () => {
    render(
      <ChatStarter composer={<div>host composer</div>}>
        <div>replacement conversation</div>
      </ChatStarter>,
    );

    expect(screen.getByText('replacement conversation')).toBeTruthy();
    expect(screen.getByText('host composer')).toBeTruthy();
  });
});
