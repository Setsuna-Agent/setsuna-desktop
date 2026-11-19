// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '@setsuna-desktop/renderer-ui';
import { DesignRichTextEditor } from '../../../src/renderer/text/DesignRichTextEditor.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps the text draft when dismissing its font picker and saves the selected range', async () => {
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 200, 24, 30));
  const save = vi.fn(async () => true);
  render(<ToastProvider><DesignRichTextEditor node={{ kind: 'text', x: 0, y: 0, width: 140, fontSize: 14, text: 'Original' }}
    disabled={false} onSave={save} translate={(key) => key} /></ToastProvider>);
  const user = userEvent.setup();
  const label = 'feature.design.inlineTextStyles';
  await user.click(screen.getByRole('button', { name: label }));
  const editor = within(await screen.findByRole('dialog', { name: label }));
  const text = editor.getByRole<HTMLTextAreaElement>('textbox', { name: 'feature.design.text' });
  await user.clear(text);
  await user.type(text, 'New text');
  text.setSelectionRange(0, 3);
  fireEvent.select(text);
  const fontsLabel = 'feature.design.localFonts';
  const fontsTrigger = editor.getByRole('button', { name: fontsLabel });
  await user.click(fontsTrigger);
  await screen.findByRole('dialog', { name: fontsLabel });
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: fontsLabel })).toBeNull();
  expect(editor.getByRole<HTMLTextAreaElement>('textbox', { name: 'feature.design.text' }).value).toBe('New text');
  expect(save).not.toHaveBeenCalled();

  await user.click(fontsTrigger);
  const fonts = within(await screen.findByRole('dialog', { name: fontsLabel }));
  await user.click(fonts.getByRole('button', { name: 'feature.design.font.serif' }));
  await user.click(editor.getByRole('button', { name: 'feature.design.save' }));
  expect(save).toHaveBeenCalledExactlyOnceWith('New text', [{ start: 0, end: 3, fontFamily: 'serif' }]);
});
