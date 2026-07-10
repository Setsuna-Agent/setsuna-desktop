import { describe, expect, it } from 'vitest';
import { markdownUrlTransform, resolveMarkdownLinkTarget } from './markdownLinks.js';

describe('markdownLinks', () => {
  it('recognizes safe external and anchor links', () => {
    expect(resolveMarkdownLinkTarget('https://example.com/docs')).toEqual({
      kind: 'external',
      href: 'https://example.com/docs',
    });
    expect(resolveMarkdownLinkTarget('#section')).toEqual({ kind: 'anchor', href: '#section' });
  });

  it('normalizes relative workspace links and extracts a line number', () => {
    expect(resolveMarkdownLinkTarget('./src/../src/main.ts:42', '/Users/dev/project')).toEqual({
      kind: 'workspace',
      line: 42,
      path: 'src/main.ts',
    });
  });

  it('shortens absolute Unix and Windows paths inside the workspace', () => {
    expect(resolveMarkdownLinkTarget('/Users/dev/project/src/main.ts#L8C3', '/Users/dev/project')).toEqual({
      kind: 'workspace',
      line: 8,
      path: 'src/main.ts',
    });
    expect(resolveMarkdownLinkTarget('C:\\Work\\Project\\src\\main.ts:9', 'c:\\work\\project')).toEqual({
      kind: 'workspace',
      line: 9,
      path: 'src/main.ts',
    });
    expect(resolveMarkdownLinkTarget('/etc/hosts', '/')).toEqual({
      kind: 'workspace',
      path: 'etc/hosts',
    });
  });

  it('rejects workspace escapes and unsafe protocols', () => {
    expect(resolveMarkdownLinkTarget('../../secret.txt', '/Users/dev/project')).toEqual({ kind: 'invalid' });
    expect(resolveMarkdownLinkTarget('/Users/dev/other/secret.txt', '/Users/dev/project')).toEqual({ kind: 'invalid' });
    expect(resolveMarkdownLinkTarget('javascript:alert(1)', '/Users/dev/project')).toEqual({ kind: 'invalid' });
    expect(markdownUrlTransform('data:text/html,unsafe')).toBe('');
  });
});
