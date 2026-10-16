// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { createElement, createRef } from 'react';
import { afterEach, expect, it } from 'vitest';
import type { RuntimePluginSummary } from '@setsuna-desktop/contracts';
import { pluginAppAppearanceKey } from '../../../../../src/kernel/declarative-plugin-ui/app-appearance/preferences.js';
import { createChatComposerCommandState } from '../../../../../src/features/chat/composer/chatComposerCommandState.js';
import { readComposerCursorOffset } from '../../../../../src/features/chat/composer/chatComposerCursorOffset.js';
import {
  createBrowserTabMentionSlot, createPluginAppMentionSlot, createSelectedPluginSlot,
  createSelectedSkillSlot, createTextSlot, createThreadMentionSlot, createWorkspaceMentionReferenceSlot,
} from '../../../../../src/features/chat/composer/chatComposerSlots.js';
import { ChatPromptInput } from '../../../../../src/features/chat/composer/editor/ChatPromptInput.js';
import { slotText } from '../../../../../src/features/chat/composer/editor/composerDocument.js';
import type { ComposerEditor, ComposerSlot } from '../../../../../src/features/chat/composer/editor/types.js';

afterEach(() => { cleanup(); localStorage.clear(); });

const app = { pluginId: 'workspace-tools', contributionId: 'dashboard', name: '工作台' };

it.each(['@', '/'])('recognizes %s after selecting an app whose display name differs from its stored reference', (marker) => {
  localStorage.setItem(pluginAppAppearanceKey(app.pluginId, app.contributionId), JSON.stringify({ name: '我的工作应用 🧰' }));
  const editor = createRef<ComposerEditor>();
  let latestCursor: number | null = null;
  render(createElement(ChatPromptInput, {
    ref: editor, value: '@工作',
    onChange: () => { latestCursor = readComposerCursorOffset(editor.current?.inputElement); },
  }));
  editor.current!.focus({ cursor: 'end' });
  const slot = createPluginAppMentionSlot(app);
  act(() => editor.current!.insert([slot, createTextSlot(' ')], 'cursor', '@工作'));
  // Menu parsing happens during onChange, before a new reference's portal label commits.
  expect(latestCursor).toBe(slotText(slot).length + 1);
  act(() => editor.current!.insert([createTextSlot(marker)]));
  const draft = editor.current!.getValue().value;
  const state = commandState(draft, latestCursor);
  expect(state.commandCursorOffset).toBe(draft.length);
  expect(marker === '@' ? state.mentionMenuOpen : state.slashMenuOpen).toBe(true);
  expect(marker === '@' ? state.mentionCommand : state.slashCommand).toEqual({ start: draft.length - 1, end: draft.length, query: '' });
});

it('counts mixed references before the caret while excluding references after it', () => {
  const plugin: RuntimePluginSummary = { id: 'git', name: 'Git', installedAt: '2026-09-13', skills: [], mcpServers: [], hooks: [], hookCount: 0, resources: [] };
  const references = [
    createPluginAppMentionSlot(app),
    createSelectedPluginSlot(plugin),
    createWorkspaceMentionReferenceSlot({ kind: 'file', name: 'main.ts', path: 'src/main.ts', parent: 'src' }),
    createBrowserTabMentionSlot({ id: 'tab-1', title: '文档', url: 'https://example.com/docs' }),
    createThreadMentionSlot({ id: 'thread-1', title: '另一段对话' }),
    createSelectedSkillSlot({ id: 'review', name: '代码检查', kind: 'builtin', enabled: true }),
  ];
  const slots: ComposerSlot[] = [createTextSlot('/earlier '), ...references.flatMap((slot) => [slot, createTextSlot(' ')]), createTextSlot('@next')];
  const editor = createRef<ComposerEditor>();
  render(createElement(ChatPromptInput, { ref: editor, slotConfig: slots }));
  editor.current!.focus({ cursor: 'end' });
  const draft = editor.current!.getValue().value;
  expect(commandState(draft, readComposerCursorOffset(editor.current!.inputElement)).mentionCommand)
    .toEqual({ start: draft.length - 5, end: draft.length, query: 'next' });

  const selection = document.getSelection()!;
  const range = document.createRange();
  range.setStart(editor.current!.inputElement!.firstChild!, '/earlier'.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  expect(commandState(draft, readComposerCursorOffset(editor.current!.inputElement)).slashCommand)
    .toEqual({ start: 0, end: '/earlier'.length, query: 'earlier' });
});

function commandState(draft: string, cursorOffset: number | null) {
  return createChatComposerCommandState({ draft, cursorOffset, focused: true, dismissedMentionDraft: '', dismissedSlashDraft: '', forcedSlashMenuOpen: false, slashMenuBlocked: false });
}
