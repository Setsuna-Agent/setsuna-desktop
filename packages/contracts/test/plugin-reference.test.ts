import { describe, expect, it } from 'vitest';
import { parsePluginMentions, pluginMentionText } from '../src/plugin-reference.js';

describe('plugin references', () => {
  it('round trips plugin identities and exact offsets through message text', () => {
    const plugin = { id: 'repo/github(enterprise)', name: 'GitHub Enterprise' };
    const reference = pluginMentionText(plugin);
    const content = `请用 ${reference} 查看仓库`;
    expect(parsePluginMentions(content)).toEqual([{
      pluginId: plugin.id, label: plugin.name, start: 3, end: 3 + reference.length,
    }]);
    expect(pluginMentionText({ id: 'github', name: '[GitHub]\n' })).toBe('[$GitHub](plugin://github)');
  });

  it('leaves code examples and malformed references as ordinary text', () => {
    const reference = pluginMentionText({ id: 'github', name: 'GitHub' });
    const content = [
      `\`${reference}\``,
      `\`\`literal \` ${reference}\`\``,
      '```markdown', reference, '```',
      '~~~', reference, '~~~',
      '~~~~', reference, '~~~~~',
      '[$bad](plugin://%zz) [$bad](plugin://has%20space) [$bad](plugin://%00)',
      reference,
      '```', reference,
    ].join('\n');
    expect(parsePluginMentions(content)).toEqual([{
      pluginId: 'github', label: 'GitHub',
      start: content.lastIndexOf(reference, content.lastIndexOf('```')),
      end: content.lastIndexOf(reference, content.lastIndexOf('```')) + reference.length,
    }]);
  });

  it('handles long malformed message text and still finds a later selection', () => {
    const reference = pluginMentionText({ id: 'github', name: 'GitHub' });
    const content = [
      `Unclosed inline code ${'`'.repeat(30_000)}`,
      '[$\\'.repeat(20_000),
      '[$\\](plugin://' + '[$!](plugin://!'.repeat(15_000),
      reference,
    ].join('\r\n');
    expect(parsePluginMentions(content)).toEqual([{
      pluginId: 'github', label: 'GitHub', start: content.length - reference.length, end: content.length,
    }]);
  });
});
