import { describe, expect, it } from 'vitest';
import { escapeSkillAttribute, neutralizePromptClosingTags } from '../../../src/loop/context/prompt-utils.js';

describe('neutralizePromptClosingTags', () => {
  it('neutralizes mixed-case closing tags while preserving surrounding data', () => {
    expect(neutralizePromptClosingTags('before </DiFf> after', ['diff'])).toBe('before <\\/DiFf> after');
  });

  it('keeps line breaks and markup inside prompt attributes', () => {
    expect(escapeSkillAttribute('a"\n<b>')).toBe('a&quot;&#10;&lt;b&gt;');
  });
});
