// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatStarter } from '../../../../../src/features/chat/conversation/ChatStarter.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('ChatStarter', () => {
  it('sends a project suggestion through the real chat send handler', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(
      <I18nProvider initialLocale="zh-CN">
        <ChatStarter composer={<div>composer</div>} projectName="Setsuna" onSend={onSend} />
      </I18nProvider>,
    );

    const prompt = '快速了解 Setsuna 的结构和关键链路';
    await userEvent.click(screen.getByRole('button', { name: prompt }));

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith(prompt);
  });
});
