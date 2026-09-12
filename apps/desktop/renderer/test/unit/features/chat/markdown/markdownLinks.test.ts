import { describe, expect, it } from 'vitest';
import {
  markdownUrlTransform,
  resolveMarkdownFileReference,
  resolveMarkdownLinkTarget,
} from '../../../../../src/features/chat/markdown/markdownLinks.js';

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

  it('rejects commands, git status, globs and expressions while keeping file locations intact', () => {
    for (const text of [
      '?? README.md', 'M README.md', 'node --experimental-strip-types scripts/snake-logic.test.mjs',
      'cat README.md', 'git diff src/main.ts', 'src/**/*.ts', '*.vue', 'foo.ts + bar.ts',
      'config.file.ts()', 'src/{a,b}.ts', 'README.md\nother.ts',
    ]) {
      expect(resolveMarkdownFileReference(text, '/workspace'), text).toBeNull();
    }
    expect(resolveMarkdownFileReference('README.md:12', '/workspace')).toEqual({ kind: 'workspace', path: 'README.md', line: 12 });
    expect(resolveMarkdownFileReference('snake-logic.test.mjs', '/workspace')).toEqual({ kind: 'workspace', path: 'snake-logic.test.mjs' });
    expect(resolveMarkdownFileReference('src/app/(auth)/[id]/page.tsx', '/workspace')).toEqual({ kind: 'workspace', path: 'src/app/(auth)/[id]/page.tsx' });
    expect(resolveMarkdownFileReference('C:\\work\\src\\main.ts:7', 'C:\\work')).toEqual({ kind: 'workspace', path: 'src/main.ts', line: 7 });
    expect(resolveMarkdownLinkTarget('docs/My%20Notes.md#L8', '/workspace')).toEqual({ kind: 'workspace', path: 'docs/My Notes.md', line: 8 });
  });
});
