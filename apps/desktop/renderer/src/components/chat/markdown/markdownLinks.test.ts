import { describe, expect, it } from 'vitest';
import { markdownUrlTransform, resolveMarkdownFileReference, resolveMarkdownLinkTarget } from './markdownLinks.js';

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

  it('recognizes inline code file references without treating identifiers as files', () => {
    expect(resolveMarkdownFileReference('help.ts', '/Users/dev/project')).toEqual({
      kind: 'workspace',
      path: 'help.ts',
    });
    expect(resolveMarkdownFileReference('src/generated/schema.custom:12', '/Users/dev/project')).toEqual({
      kind: 'workspace',
      line: 12,
      path: 'src/generated/schema.custom',
    });
    expect(resolveMarkdownFileReference('invoice_status', '/Users/dev/project')).toBeNull();
    expect(resolveMarkdownFileReference('getInvoiceWalletItemsData', '/Users/dev/project')).toBeNull();
    expect(resolveMarkdownFileReference('example.com', '/Users/dev/project')).toBeNull();
  });
});
