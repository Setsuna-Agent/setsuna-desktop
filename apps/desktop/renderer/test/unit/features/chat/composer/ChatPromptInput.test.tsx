// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatPromptInput } from '../../../../../src/features/chat/composer/editor/ChatPromptInput.js';
import type { ComposerEditor } from '../../../../../src/features/chat/composer/editor/types.js';
import { createWorkspaceMentionSlots } from '../../../../../src/features/chat/composer/chatComposerSlots.js';

afterEach(cleanup);

it('keeps IME confirmation and Shift+Enter separate from sending the current draft', () => {
  const editor = createRef<ComposerEditor>();
  const submit = vi.fn();
  render(<ChatPromptInput ref={editor} value="你好" onSubmit={submit} />);
  const input = screen.getByRole('textbox');
  editor.current?.focus({ cursor: 'end' });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(editor.current?.getValue().value).toBe('你好\n');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(submit).toHaveBeenCalledExactlyOnceWith('你好\n');
});

it('replaces only the active mention command and submits the full path behind its short label', () => {
  const editor = createRef<ComposerEditor>();
  render(<ChatPromptInput ref={editor} value="保留 @foo，然后查看 @fo" />);
  editor.current?.focus({ cursor: 'end' });
  const slots = createWorkspaceMentionSlots({ kind: 'file', name: 'Foo.tsx', parent: 'src', path: 'src/Foo.tsx' });
  // Imperative insertions are the interface used by command menus and external file requests.
  fireEvent.focus(screen.getByRole('textbox'));
  act(() => editor.current?.insert(slots, 'cursor', '@fo'));
  expect(editor.current?.getValue().value).toBe('保留 @foo，然后查看 @src/Foo.tsx ');
  expect(editor.current?.getValue().slotConfig.filter((slot) => slot.type === 'tag')).toHaveLength(1);
});
