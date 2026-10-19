import { parseMentionCommand, parseSkillCommand, parseSlashCommand, type TextCommand } from './chatCommandUtils.js';

export type ChatComposerCommandStateInput = {
  cursorOffset: number | null;
  dismissedMentionDraft: string;
  dismissedSlashDraft: string;
  draft: string;
  focused: boolean;
  forcedSlashMenuOpen: boolean;
  slashMenuBlocked: boolean;
};

export type ChatComposerCommandState = {
  commandCursorOffset: number;
  mentionCommand: TextCommand | null;
  mentionMenuOpen: boolean;
  mentionQuery: string;
  skillCommand: TextCommand | null;
  slashCommand: TextCommand | null;
  slashMenuOpen: boolean;
  slashQuery: string;
};

export function createChatComposerCommandState(
  input: ChatComposerCommandStateInput,
): ChatComposerCommandState {
  const commandCursorOffset = input.cursorOffset ?? input.draft.length;
  const mentionCommand = parseMentionCommand(input.draft, commandCursorOffset);
  const slashCommand = parseSlashCommand(input.draft, commandCursorOffset);
  const skillCommand = parseSkillCommand(input.draft, commandCursorOffset);
  // Both triggers share one palette lifecycle; $ narrows its candidates to Skills.
  const paletteCommand = skillCommand ?? slashCommand;
  const mentionMenuOpen = Boolean(
    input.focused
    && mentionCommand
    && input.dismissedMentionDraft !== input.draft,
  );
  const slashMenuOpen = Boolean(
    !input.slashMenuBlocked
    && input.focused
    && !mentionMenuOpen
    && (paletteCommand
      ? input.dismissedSlashDraft !== input.draft
      : input.forcedSlashMenuOpen),
  );

  return {
    commandCursorOffset,
    mentionCommand,
    mentionMenuOpen,
    mentionQuery: mentionCommand?.query ?? '',
    skillCommand,
    slashCommand,
    slashMenuOpen,
    slashQuery: paletteCommand?.query.trim().toLowerCase() ?? '',
  };
}

export function moveChatCommandMenuIndex(
  currentIndex: number,
  direction: -1 | 1,
  itemCount: number,
): number {
  if (itemCount <= 0) return 0;
  return (currentIndex + direction + itemCount) % itemCount;
}
