import { describe, expect, it } from 'vitest';
import { fileLanguage, highlightedCodeLinesHtml } from '../../../../src/features/workspace/codeHighlight.js';

describe('workspace code highlighting', () => {
  it('uses JSX-aware Prism grammars for component source files', () => {
    expect(fileLanguage('src/App.jsx')).toBe('jsx');
    expect(fileLanguage('src/App.tsx')).toBe('tsx');
    expect(fileLanguage('src/App.vue')).toBe('tsx');
  });

  it('emits fine-grained token classes for TypeScript', () => {
    const [highlighted] = highlightedCodeLinesHtml("export type Status = 'ready';", 'typescript');

    expect(highlighted).toContain('token keyword');
    expect(highlighted).toContain('token class-name');
    expect(highlighted).toContain('token operator');
    expect(highlighted).toContain('token string');
  });

  it('keeps multiline tokens balanced on every rendered line', () => {
    const highlighted = highlightedCodeLinesHtml('/* first line\nsecond line */', 'typescript');

    expect(highlighted).toHaveLength(2);
    expect(highlighted[0]).toMatch(/^<span class="token comment">.*<\/span>$/u);
    expect(highlighted[1]).toMatch(/^<span class="token comment">.*<\/span>$/u);
  });

  it('escapes source text before it is rendered as HTML', () => {
    const [highlighted] = highlightedCodeLinesHtml('const markup = "<img>";', 'typescript');

    expect(highlighted).toContain('&lt;img&gt;');
    expect(highlighted).not.toContain('<img>');
  });
});
