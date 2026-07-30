import { describe, expect, it } from 'vitest';
import {
  createChatComposerCommandState,
  moveChatCommandMenuIndex,
} from '../../../../../src/features/chat/composer/chatComposerCommandState.js';

describe('chat composer command state', () => {
  it('gives an active mention precedence over a forced slash menu', () => {
    const state = createChatComposerCommandState({
      cursorOffset: null,
      dismissedMentionDraft: '',
      dismissedSlashDraft: '',
      draft: 'inspect @src',
      focused: true,
      forcedSlashMenuOpen: true,
      slashMenuBlocked: false,
    });

    expect(state.mentionCommand).toEqual({ start: 8, end: 12, query: 'src' });
    expect(state.mentionMenuOpen).toBe(true);
    expect(state.slashMenuOpen).toBe(false);
  });

  it('keeps dismissal scoped to the exact draft value', () => {
    const dismissed = createChatComposerCommandState({
      cursorOffset: null,
      dismissedMentionDraft: 'inspect @src',
      dismissedSlashDraft: '',
      draft: 'inspect @src',
      focused: true,
      forcedSlashMenuOpen: false,
      slashMenuBlocked: false,
    });
    const changed = createChatComposerCommandState({
      cursorOffset: null,
      dismissedMentionDraft: 'inspect @src',
      dismissedSlashDraft: '',
      draft: 'inspect @src/components',
      focused: true,
      forcedSlashMenuOpen: false,
      slashMenuBlocked: false,
    });

    expect(dismissed.mentionMenuOpen).toBe(false);
    expect(changed.mentionMenuOpen).toBe(true);
    expect(changed.mentionQuery).toBe('src/components');
  });

  it('blocks typed and forced slash menus during a queued edit', () => {
    for (const forcedSlashMenuOpen of [false, true]) {
      const state = createChatComposerCommandState({
        cursorOffset: null,
        dismissedMentionDraft: '',
        dismissedSlashDraft: '',
        draft: forcedSlashMenuOpen ? '' : '/review',
        focused: true,
        forcedSlashMenuOpen,
        slashMenuBlocked: true,
      });

      expect(state.slashMenuOpen).toBe(false);
    }
  });

  it('uses the cursor-local command and normalizes slash search text', () => {
    const draft = 'first /ignored then /ReView later';
    const state = createChatComposerCommandState({
      cursorOffset: 'first /ignored then /ReView'.length,
      dismissedMentionDraft: '',
      dismissedSlashDraft: '',
      draft,
      focused: true,
      forcedSlashMenuOpen: false,
      slashMenuBlocked: false,
    });

    expect(state.slashCommand).toEqual({
      start: 'first /ignored then '.length,
      end: 'first /ignored then /ReView'.length,
      query: 'ReView',
    });
    expect(state.slashQuery).toBe('review');
    expect(state.slashMenuOpen).toBe(true);
  });

  it('wraps keyboard navigation without producing an index for an empty menu', () => {
    expect(moveChatCommandMenuIndex(0, 1, 3)).toBe(1);
    expect(moveChatCommandMenuIndex(2, 1, 3)).toBe(0);
    expect(moveChatCommandMenuIndex(0, -1, 3)).toBe(2);
    expect(moveChatCommandMenuIndex(4, 1, 0)).toBe(0);
  });
});
