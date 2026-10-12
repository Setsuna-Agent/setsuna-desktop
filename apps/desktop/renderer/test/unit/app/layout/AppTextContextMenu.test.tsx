// @vitest-environment happy-dom

import type { DesktopTextEditCommand } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppTextContextMenu } from '../../../../src/app/layout/AppTextContextMenu.js';
import { CHAT_COMPOSER_CLIPBOARD_TYPE } from '../../../../src/features/chat/composer/chatComposerClipboard.js';
import { createWorkspaceMentionSlots } from '../../../../src/features/chat/composer/chatComposerSlots.js';
import { ChatPromptInput } from '../../../../src/features/chat/composer/editor/ChatPromptInput.js';
import type { ComposerEditor } from '../../../../src/features/chat/composer/editor/types.js';
import { useChatComposerClipboard } from '../../../../src/features/chat/composer/useChatComposerClipboard.js';

const executeTextEdit = vi.fn<(command: DesktopTextEditCommand) => Promise<boolean>>();

beforeEach(() => {
  executeTextEdit.mockReset().mockResolvedValue(true);
  vi.stubGlobal('setsunaDesktop', { windowControls: { executeTextEdit } });
});
afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

it.each([
  ['cut', '剪切'], ['copy', '复制'], ['paste', '粘贴'],
] as const)('restores a text input selection before native %s', async (command, label) => {
  render(<><AppTextContextMenu /><input aria-label="名称" defaultValue="before after" /></>);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  const applied = vi.fn();
  input.focus();
  input.setSelectionRange(2, 6, 'backward');
  executeTextEdit.mockImplementation(async () => {
    applied(document.activeElement, input.selectionStart, input.selectionEnd, input.selectionDirection);
    return true;
  });
  fireEvent.contextMenu(input);
  const item = await screen.findByRole('menuitem', { name: label });
  input.setSelectionRange(0, 0);
  fireEvent.click(item);
  await waitFor(() => expect(executeTextEdit).toHaveBeenCalledExactlyOnceWith(command));
  expect(applied).toHaveBeenCalledExactlyOnceWith(input, 2, 6, 'backward');
});

it('preserves structured references through context-menu cut and paste into the empty composer', async () => {
  const editor = createRef<ComposerEditor>();
  const clipboardData = new DataTransfer();
  const slots = createWorkspaceMentionSlots({ kind: 'file', name: 'Example.ts', parent: 'src', path: 'src/Example.ts' });
  function Composer() {
    const clipboard = useChatComposerClipboard({ getEditor: () => editor.current, skills: [], onSkillsRestored: vi.fn() });
    return <ChatPromptInput ref={editor} slotConfig={slots} {...clipboard} />;
  }
  executeTextEdit.mockImplementation(async (command) => {
    // The IPC boundary invokes Electron; dispatch its clipboard event here without replacing the editor logic.
    fireEvent[command](document.activeElement!, { clipboardData });
    return true;
  });
  render(<><AppTextContextMenu /><Composer /></>);
  const input = screen.getByRole('textbox');
  const original = editor.current!.getValue().value;
  act(() => editor.current!.focus({ cursor: 'all' }));
  fireEvent.contextMenu(input);
  const cut = await screen.findByRole('menuitem', { name: '剪切' });
  document.getSelection()?.removeAllRanges();
  fireEvent.click(cut);
  await waitFor(() => expect(editor.current!.getValue().value).toBe(''));
  expect(clipboardData.getData(CHAT_COMPOSER_CLIPBOARD_TYPE)).toContain('src/Example.ts');

  document.getSelection()?.removeAllRanges();
  fireEvent.contextMenu(input);
  fireEvent.click(await screen.findByRole('menuitem', { name: '粘贴' }));
  await waitFor(() => expect(editor.current!.getValue().value).toBe(original));
  expect(editor.current!.getValue().slotConfig.filter((slot) => slot.type === 'tag')).toHaveLength(1);
  expect(executeTextEdit.mock.calls.map(([command]) => command)).toEqual(['cut', 'paste']);
});

it('copies only the selected reading text without targeting a previously focused input', async () => {
  render(<><AppTextContextMenu /><input defaultValue="unrelated draft" /><p>selected reading text</p><p>other text</p></>);
  const text = screen.getByText('selected reading text');
  const applied = vi.fn();
  screen.getByRole('textbox').focus();
  fireEvent.contextMenu(text);
  expect(screen.queryByRole('menu')).toBeNull();
  const range = document.createRange();
  range.setStart(text.firstChild!, 9);
  range.setEnd(text.firstChild!, 16);
  document.getSelection()!.addRange(range);
  fireEvent.contextMenu(screen.getByText('other text'));
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.contextMenu(text);
  const copy = await screen.findByRole('menuitem', { name: '复制' });
  expect(screen.queryByRole('menuitem', { name: '剪切' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: '粘贴' })).toBeNull();
  executeTextEdit.mockImplementation(async () => {
    applied(document.activeElement?.tagName, document.getSelection()?.toString());
    return true;
  });
  document.getSelection()?.removeAllRanges();
  fireEvent.click(copy);
  await waitFor(() => expect(executeTextEdit).toHaveBeenCalledExactlyOnceWith('copy'));
  expect(applied).toHaveBeenCalledExactlyOnceWith('BODY', 'reading');
});

it('offers only copy for readonly text and leaves specialized menus in control', async () => {
  render(<><AppTextContextMenu /><textarea readOnly defaultValue="read only" />
    <input aria-label="specialized" onContextMenu={(event) => event.preventDefault()} /></>);
  fireEvent.contextMenu(screen.getByRole('textbox', { name: 'specialized' }));
  expect(screen.queryByRole('menu')).toBeNull();
  const input = screen.getByDisplayValue('read only') as HTMLTextAreaElement;
  input.setSelectionRange(0, 4);
  fireEvent.contextMenu(input);
  expect(await screen.findByRole('menuitem', { name: '复制' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: '剪切' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: '粘贴' })).toBeNull();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(executeTextEdit).not.toHaveBeenCalled();
});

it('does not execute a pending edit after the original field becomes disabled', async () => {
  const view = render(<><AppTextContextMenu /><input defaultValue="draft" /></>);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  input.setSelectionRange(0, 5);
  fireEvent.contextMenu(input);
  const cut = await screen.findByRole('menuitem', { name: '剪切' });
  view.rerender(<><AppTextContextMenu /><input defaultValue="draft" disabled /></>);
  fireEvent.click(cut);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(executeTextEdit).not.toHaveBeenCalled();
});
