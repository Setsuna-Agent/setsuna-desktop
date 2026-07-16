import { describe, expect, it } from 'vitest';
import { parseMentionCommand, parseSlashCommand } from './chatCommandUtils.js';
import {
  applyComposerCursorOffsetAdjustments,
  composerCursorOffsetAdjustment,
} from './chatComposerCursorOffset.js';

describe('chat composer cursor offsets', () => {
  it('keeps @ and / commands aligned after a visually shortened workspace mention', () => {
    const renderedMention = 'Tile.tsx';
    const serializedMention = '@src/components/Tile.tsx';
    const adjustment = composerCursorOffsetAdjustment(serializedMention, renderedMention);

    const mentionDraft = `${serializedMention} 请检查 @`;
    const mentionVisibleOffset = `${renderedMention} 请检查 @`.length;
    const mentionOffset = applyComposerCursorOffsetAdjustments(mentionVisibleOffset, [String(adjustment)]);
    expect(mentionOffset).toBe(mentionDraft.length);
    expect(parseMentionCommand(mentionDraft, mentionOffset)).toEqual({
      start: mentionDraft.length - 1,
      end: mentionDraft.length,
      query: '',
    });

    const slashDraft = `${serializedMention} 请检查 /`;
    const slashVisibleOffset = `${renderedMention} 请检查 /`.length;
    const slashOffset = applyComposerCursorOffsetAdjustments(slashVisibleOffset, [adjustment]);
    expect(slashOffset).toBe(slashDraft.length);
    expect(parseSlashCommand(slashDraft, slashOffset)).toEqual({
      start: slashDraft.length - 1,
      end: slashDraft.length,
      query: '',
    });
  });

  it('adds the adjustment for every preceding mention slot', () => {
    const renderedMentions = ['Tile.tsx', 'README.md'];
    const serializedMentions = ['@src/components/Tile.tsx', '@docs/README.md'];
    const visibleOffset = `${renderedMentions.join(' ')} @`.length;
    const serializedDraft = `${serializedMentions.join(' ')} @`;
    const adjustments = serializedMentions.map((mention, index) => (
      composerCursorOffsetAdjustment(mention, renderedMentions[index] ?? '')
    ));

    expect(applyComposerCursorOffsetAdjustments(visibleOffset, adjustments)).toBe(serializedDraft.length);
  });
});
