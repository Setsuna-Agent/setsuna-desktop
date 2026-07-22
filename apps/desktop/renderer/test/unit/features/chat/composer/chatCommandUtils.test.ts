import { describe, expect, it } from 'vitest';
import { parseMentionCommand, parseSlashCommand } from '../../../../../src/features/chat/composer/chatCommandUtils.js';

describe('chat command parsing', () => {
  it('keeps parsing commands at the end of the draft', () => {
    expect(parseMentionCommand('open @src')).toEqual({ start: 5, end: 9, query: 'src' });
    expect(parseSlashCommand('use /skill')).toEqual({ start: 4, end: 10, query: 'skill' });
  });

  it('parses command tokens around the current cursor', () => {
    expect(parseMentionCommand('open @src then continue', 'open @src'.length)).toEqual({ start: 5, end: 9, query: 'src' });
    expect(parseSlashCommand('use /skill then continue', 'use /skill'.length)).toEqual({ start: 4, end: 10, query: 'skill' });
  });

  it('parses isolated middle markers when whitespace surrounds them', () => {
    expect(parseSlashCommand('阿斯达大 / @ 大撒对对对', '阿斯达大 / '.length)).toEqual({ start: 5, end: 7, query: '' });
    expect(parseMentionCommand('阿斯达大 / @ 大撒对对对', '阿斯达大 / @ '.length)).toEqual({ start: 7, end: 9, query: '' });
  });

  it('does not parse markers that are attached to other characters', () => {
    expect(parseMentionCommand('email dev@example.com')).toBeNull();
    expect(parseSlashCommand('path src/components')).toBeNull();
    expect(parseMentionCommand('open @srcFile then continue', 'open @src'.length)).toBeNull();
  });
});
