// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatPromptInput } from '../../../../../src/features/chat/composer/editor/ChatPromptInput.js';
import type { ComposerEditor } from '../../../../../src/features/chat/composer/editor/types.js';
import { createReferenceDraftSlots, createTextSlot, createWorkspaceDraftReferences, createWorkspaceMentionSlots, getChatComposerSlotReference } from '../../../../../src/features/chat/composer/chatComposerSlots.js';
import { useChatComposerSession, type ChatComposerTargetIdentity } from '../../../../../src/features/chat/hooks/useChatComposerSession.js';

afterEach(() => { cleanup(); localStorage.clear(); });

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

it('supports multiline comments with modifier-Enter submission without sending IME confirmation', () => {
  const editor = createRef<ComposerEditor>();
  const submit = vi.fn();
  render(<ChatPromptInput ref={editor} value="你好" submitOn="mod-enter" onSubmit={submit} />);
  const input = screen.getByRole('textbox');
  editor.current?.focus({ cursor: 'end' });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(editor.current?.getValue().value).toBe('你好\n');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  expect(submit).toHaveBeenCalledExactlyOnceWith('你好\n');
});

it('submits an empty draft with Enter only when attachments make it sendable', () => {
  const submit = vi.fn();
  const { rerender } = render(<ChatPromptInput onSubmit={submit} />);
  const input = screen.getByRole('textbox');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(submit).not.toHaveBeenCalled();

  rerender(<ChatPromptInput allowEmptySubmit onSubmit={submit} />);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(submit).toHaveBeenCalledExactlyOnceWith('');
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

it('restores editable drafts with file and directory slots after switching conversations and restarting', () => {
  const editor = createRef<ComposerEditor>();
  const client = { uploadAttachment: vi.fn(), deleteAttachment: vi.fn(), linkAttachment: vi.fn() };
  const submit = vi.fn();
  function SessionEditor({ target }: { target: ChatComposerTargetIdentity }) {
    const session = useChatComposerSession(target, client, 'primary:0');
    return <ChatPromptInput key={session.composerKey} ref={editor} value={session.draft}
      slotConfig={createReferenceDraftSlots(session.draft, [], [], [], session.draftWorkspaceReferences)}
      onChange={(value, _event, slots) => session.setDraft(value, [], createWorkspaceDraftReferences(slots))} onSubmit={submit} />;
  }
  const view = render(<SessionEditor target="thread:A" />);
  act(() => editor.current!.insert([
    ...createWorkspaceMentionSlots({ kind: 'directory', name: 'agent-pc', path: 'src/domain/agent-pc', parent: 'src/domain' }),
    ...createWorkspaceMentionSlots({ kind: 'file', name: 'spec.md', path: 'spec.md', absolutePath: '/other root/spec.md', parent: '', rootId: 'other-root' }),
    createTextSlot('1231313213 @src/domain/agent-pc/'),
  ], 'end'));
  const draft = editor.current!.getValue().value;
  view.rerender(<SessionEditor target="thread:B" />);
  expect(editor.current!.getValue().value).toBe('');
  act(() => editor.current!.insert([createTextSlot('另一段草稿')]));
  view.rerender(<SessionEditor target="thread:A" />);
  const assertRestored = () => {
    const current = editor.current!.getValue();
    expect(current.value).toBe(draft);
    expect(current.slotConfig.map(getChatComposerSlotReference).filter(Boolean)).toEqual([
      { type: 'workspace', entry: expect.objectContaining({ kind: 'directory', path: 'src/domain/agent-pc' }) },
      { type: 'workspace', entry: expect.objectContaining({ kind: 'file', path: 'spec.md', absolutePath: '/other root/spec.md', rootId: 'other-root' }) },
    ]);
  };
  assertRestored();
  view.unmount();
  render(<SessionEditor target="thread:A" />);
  assertRestored();
  editor.current!.focus({ cursor: 'end' });
  act(() => editor.current!.insert([createTextSlot(' 继续检查')]));
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(submit).toHaveBeenCalledExactlyOnceWith(`${draft} 继续检查`);
});
