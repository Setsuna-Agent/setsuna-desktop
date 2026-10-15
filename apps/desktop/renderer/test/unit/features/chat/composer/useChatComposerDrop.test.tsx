// @vitest-environment happy-dom

import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { threadMentionText } from '@setsuna-desktop/contracts';
import { writeThreadReferenceDrag } from '../../../../../src/shared/lib/threadReferenceDrag.js';
import { ChatPromptInput } from '../../../../../src/features/chat/composer/editor/ChatPromptInput.js';
import type { ComposerEditor } from '../../../../../src/features/chat/composer/editor/types.js';
import { useChatComposerDrop } from '../../../../../src/features/chat/composer/useChatComposerDrop.js';
import { createReferenceDraftSlots, getChatComposerSlotReference } from '../../../../../src/features/chat/composer/chatComposerSlots.js';
import { createChatComposerClipboardPastePlan, createChatComposerClipboardSelection } from '../../../../../src/features/chat/composer/chatComposerClipboard.js';

afterEach(cleanup);
const thread = { id: 'thread_other', title: '滚动修复' };

function fixture(disabled = false, filesDisabled = false) {
  const editor = createRef<ComposerEditor>();
  const submit = vi.fn();
  const onFiles = vi.fn();
  function Composer() {
    const drop = useChatComposerDrop({ disabled, filesDisabled, getEditor: () => editor.current, onFiles });
    return <div {...drop.handlers} data-testid="composer">
      <ChatPromptInput ref={editor} value="保留现有文字" disabled={disabled} onSubmit={submit} />
    </div>;
  }
  render(<Composer />);
  const input = screen.getByRole('textbox');
  const dataTransfer = new DataTransfer();
  writeThreadReferenceDrag(dataTransfer, thread);
  return { editor, submit, onFiles, input, dataTransfer, surface: screen.getByTestId('composer') };
}

it('appends a conversation without replacing selected draft text and sends its identity only once', () => {
  const { editor, submit, input, dataTransfer, surface } = fixture();
  editor.current?.focus({ cursor: 'all' });
  expect(fireEvent.dragOver(input, { dataTransfer })).toBe(false);
  fireEvent.drop(surface, { dataTransfer });
  fireEvent.drop(input, { dataTransfer });
  const value = `保留现有文字 ${threadMentionText(thread)} `;
  expect(editor.current?.getValue().value).toBe(value);
  expect(editor.current?.getValue().slotConfig.map(getChatComposerSlotReference).filter(Boolean))
    .toEqual([{ type: 'thread', thread }]);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(submit).toHaveBeenCalledExactlyOnceWith(value);
});

it('retains identity through draft restoration and structured copy/paste', () => {
  const { editor, input, dataTransfer } = fixture();
  fireEvent.drop(input, { dataTransfer });
  const current = editor.current!.getValue();
  const restored = createReferenceDraftSlots(current.value, []);
  expect(restored.map(getChatComposerSlotReference).filter(Boolean)).toEqual([{ type: 'thread', thread }]);
  editor.current?.focus({ cursor: 'all' });
  const selection = createChatComposerClipboardSelection(input as HTMLDivElement, current.slotConfig);
  expect(selection).not.toBeNull();
  const pasted = createChatComposerClipboardPastePlan(selection!.payload, []);
  expect(pasted?.slots.map(getChatComposerSlotReference).filter(Boolean)).toEqual([{ type: 'thread', thread }]);
  expect(pasted?.selectedSkills).toEqual([]);
});

it('rejects internal drops while disabled and does not turn them into native text or HTML drops', () => {
  const { editor, input, dataTransfer } = fixture(true);
  expect(fireEvent.dragOver(input, { dataTransfer })).toBe(false);
  expect(fireEvent.drop(input, { dataTransfer })).toBe(false);
  expect(editor.current?.getValue().value).toBe('保留现有文字');
});

it('ignores malformed internal payloads while leaving unrelated drops alone', () => {
  const { editor, input, dataTransfer } = fixture();
  const customType = dataTransfer.types.find((type) => type !== 'text/plain')!;
  dataTransfer.setData(customType, JSON.stringify({ id: '../private', title: 'wrong' }));
  expect(fireEvent.drop(input, { dataTransfer })).toBe(false);
  expect(editor.current?.getValue().value).toBe('保留现有文字');
  const external = new DataTransfer();
  external.setData('text/plain', 'ordinary text');
  expect(fireEvent.dragOver(input, { dataTransfer: external })).toBe(true);
  expect(fireEvent.drop(input, { dataTransfer: external })).toBe(true);
});

it('adds a multi-file OS drop once without inserting its URL or replacing the draft', () => {
  const { editor, input, onFiles } = fixture();
  editor.current?.focus({ cursor: 'all' });
  const files = [new File(['pdf'], '报告.pdf', { type: 'application/pdf' }), new File(['png'], '图片.png', { type: 'image/png' })];
  const data = new DataTransfer();
  files.forEach((file) => data.items.add(file));
  data.setData('text/uri-list', 'file:///private/report.pdf');
  const over = createEvent.dragOver(input, { dataTransfer: data });
  expect(fireEvent(input, over)).toBe(false);
  expect((over as DragEvent).dataTransfer?.dropEffect).toBe('copy');
  expect(fireEvent.drop(input, { dataTransfer: data })).toBe(false);
  expect(onFiles).toHaveBeenCalledExactlyOnceWith(files);
  expect(editor.current?.getValue().value).toBe('保留现有文字');
});

it.each([[true, false], [false, true]])('blocks file navigation and upload when disabled=%s or at limit=%s', (disabled, filesDisabled) => {
  const { editor, input, onFiles } = fixture(disabled, filesDisabled);
  const data = new DataTransfer();
  data.items.add(new File(['text'], 'file.txt', { type: 'text/plain' }));
  const over = createEvent.dragOver(input, { dataTransfer: data });
  expect(fireEvent(input, over)).toBe(false);
  expect((over as DragEvent).dataTransfer?.dropEffect).toBe('none');
  expect(fireEvent.drop(input, { dataTransfer: data })).toBe(false);
  expect(onFiles).not.toHaveBeenCalled();
  expect(editor.current?.getValue().value).toBe('保留现有文字');
});

it('skips directories without losing files from the same drop', () => {
  const { input, onFiles } = fixture();
  const file = new File(['text'], 'file.txt');
  const directory = new File([], 'folder');
  const data = new DataTransfer();
  data.items.add(directory);
  const item = data.items[0];
  Object.defineProperty(item, 'webkitGetAsEntry', { value: () => ({ isDirectory: true }) });
  data.items.add(file);
  fireEvent.drop(input, { dataTransfer: data });
  expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]);
});
