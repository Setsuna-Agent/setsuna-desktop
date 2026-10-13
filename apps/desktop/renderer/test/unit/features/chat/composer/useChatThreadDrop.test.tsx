// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { threadMentionText } from '@setsuna-desktop/contracts';
import { writeThreadReferenceDrag } from '../../../../../src/shared/lib/threadReferenceDrag.js';
import { ChatPromptInput } from '../../../../../src/features/chat/composer/editor/ChatPromptInput.js';
import type { ComposerEditor } from '../../../../../src/features/chat/composer/editor/types.js';
import { useChatThreadDrop } from '../../../../../src/features/chat/composer/useChatThreadDrop.js';
import { createReferenceDraftSlots, getChatComposerSlotReference } from '../../../../../src/features/chat/composer/chatComposerSlots.js';
import { createChatComposerClipboardPastePlan, createChatComposerClipboardSelection } from '../../../../../src/features/chat/composer/chatComposerClipboard.js';

afterEach(cleanup);
const thread = { id: 'thread_other', title: '滚动修复' };

function fixture(disabled = false) {
  const editor = createRef<ComposerEditor>();
  const submit = vi.fn();
  function Composer() {
    const drop = useChatThreadDrop({ disabled, getEditor: () => editor.current });
    return <div {...drop.handlers} data-testid="composer">
      <ChatPromptInput ref={editor} value="保留现有文字" disabled={disabled} onSubmit={submit} />
    </div>;
  }
  render(<Composer />);
  const input = screen.getByRole('textbox');
  const dataTransfer = new DataTransfer();
  writeThreadReferenceDrag(dataTransfer, thread);
  return { editor, submit, input, dataTransfer, surface: screen.getByTestId('composer') };
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
