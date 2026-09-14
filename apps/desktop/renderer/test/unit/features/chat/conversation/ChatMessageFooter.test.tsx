// @vitest-environment happy-dom

import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatMessageFooter } from '../../../../../src/features/chat/conversation/ChatMessageFooter.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';
import { copyTextToClipboard } from '../../../../../src/shared/lib/clipboard.js';

vi.mock('../../../../../src/shared/lib/clipboard.js', () => ({ copyTextToClipboard: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

const message: RuntimeMessage = {
  id: 'message', role: 'assistant', content: 'Message to copy', status: 'complete',
  createdAt: '2026-09-13T06:00:00Z',
};

it('confirms successful clipboard writes and restarts confirmation on another click', async () => {
  vi.useFakeTimers();
  let completeCopy!: () => void;
  vi.mocked(copyTextToClipboard).mockReturnValueOnce(new Promise<void>((resolve) => { completeCopy = resolve; }))
    .mockResolvedValue(undefined);
  const view = render(<I18nProvider initialLocale="zh-CN"><ChatMessageFooter message={message} /></I18nProvider>);
  fireEvent.click(screen.getByRole('button', { name: '复制' }));
  expect(copyTextToClipboard).toHaveBeenCalledWith(message.content);
  expect(screen.queryByRole('button', { name: '已复制' })).toBeNull();

  await act(async () => completeCopy());
  const button = screen.getByRole('button', { name: '已复制' });
  act(() => vi.advanceTimersByTime(1000));
  await act(async () => fireEvent.click(button));
  act(() => vi.advanceTimersByTime(600));
  expect(screen.getByRole('button', { name: '已复制' })).toBe(button);
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole('button', { name: '复制' })).toBe(button);

  await act(async () => fireEvent.click(button));
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not confirm failed clipboard writes and disables copying empty text', async () => {
  vi.mocked(copyTextToClipboard).mockRejectedValue(new Error('Clipboard unavailable'));
  const view = render(<ChatMessageFooter message={message} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '复制' })));
  expect(screen.queryByRole('button', { name: '已复制' })).toBeNull();
  view.rerender(<ChatMessageFooter message={{ ...message, content: '' }} />);
  const button = screen.getByRole('button', { name: '复制' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(copyTextToClipboard).toHaveBeenCalledTimes(1);
});
