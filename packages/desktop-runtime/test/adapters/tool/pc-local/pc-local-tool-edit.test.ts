import { describe, expect, it } from 'vitest';
import {
  applyTextEdits,
  parseTextEditRequest,
  type TextEdit,
} from '../../../../src/adapters/tool/pc-local/pc-local-tool-edit.js';

function apply(source: string, edits: TextEdit[]) {
  return applyTextEdits(source, { edits, replaceAll: false, allowCreate: false }, 'source.ts');
}

describe('targeted text edits', () => {
  it('matches every entry against the original even when replacements create other search strings', () => {
    expect(apply('first\nsecond\nthird\n', [
      { old_string: 'third', new_string: 'first' },
      { old_string: 'first', new_string: 'second' },
      { old_string: 'second', new_string: '$& ${value}' },
    ])).toEqual({ ok: true, content: 'second\n$& ${value}\nfirst\n' });
  });

  it.each([
    { source: 'aaaa', edits: [{ old_string: 'aaa', new_string: 'b' }], error: '匹配了多处' },
    { source: 'abcdef', edits: [{ old_string: 'abcd', new_string: 'X' }, { old_string: 'cdef', new_string: 'Y' }], error: '范围重叠' },
    { source: 'abcdef', edits: [{ old_string: 'abcdef', new_string: 'X' }, { old_string: 'cd', new_string: 'Y' }], error: '范围重叠' },
    { source: 'first\nsecond', edits: [{ old_string: 'first', new_string: 'FIRST' }, { old_string: 'missing', new_string: 'SECOND' }], error: 'edits[1]' },
  ])('rejects ambiguous, overlapping or missing source ranges: $source / $error', ({ source, edits, error }) => {
    expect(apply(source, edits)).toEqual({ ok: false, error: expect.stringContaining(error) });
  });

  it('accepts adjacent replacements and an explicit deletion', () => {
    expect(apply('abcdef', [
      { old_string: 'abc', new_string: '' },
      { old_string: 'def', new_string: 'remaining' },
    ])).toEqual({ ok: true, content: 'remaining' });
  });

  it.each(['\n', '\r\n', '\r'])('matches different argument newlines while preserving the source style %j', (ending) => {
    const source = ['prefix', 'old', 'middle', 'tail'].join(ending);
    expect(apply(source, [{ old_string: 'old\r\nmiddle', new_string: 'new\ncontent' }]))
      .toEqual({ ok: true, content: ['prefix', 'new', 'content', 'tail'].join(ending) });
  });

  it('preserves BOM and untouched mixed newlines, including ranges ending at a CRLF', () => {
    const source = '\uFEFF标题\r\nfirst\r\nsecond\nlast\r\n尾行';
    expect(apply(source, [
      { old_string: 'first\nsecond', new_string: 'replacement\nblock' },
      { old_string: 'last\n', new_string: '' },
    ])).toEqual({ ok: true, content: '\uFEFF标题\r\nreplacement\r\nblock\n尾行' });
  });

  it('preserves the file BOM when omitted from the replacement and keeps interior U+FEFF literal', () => {
    expect(apply('\uFEFFheader\r\nliteral \uFEFFbody\n', [
      { old_string: '\uFEFFheader', new_string: 'changed' },
      { old_string: '\uFEFFbody', new_string: '\uFEFFtail' },
    ])).toEqual({ ok: true, content: '\uFEFFchanged\r\nliteral \uFEFFtail\n' });
  });

  it('does not duplicate the file BOM when only the replacement includes it', () => {
    expect(apply('\uFEFFheader\n', [{ old_string: 'header', new_string: '\uFEFFchanged' }]))
      .toEqual({ ok: true, content: '\uFEFFchanged\n' });
  });

  it('does not silently ignore source whitespace or normalize code characters', () => {
    expect(apply('  const dash = "—";  \n', [{ old_string: 'const dash = "-";\n', new_string: 'changed' }]))
      .toMatchObject({ ok: false });
  });

  it('preserves a no-op entry in mixed-newline files while applying the rest of the batch', () => {
    const source = 'first\r\nsecond\nthird\n';
    const noOp = { old_string: 'second\r\nthird', new_string: 'second\nthird' };
    expect(apply(source, [noOp])).toMatchObject({ ok: false, error: expect.stringContaining('没有需要应用的变化') });
    expect(apply(source, [noOp, { old_string: 'first', new_string: 'changed' }]))
      .toEqual({ ok: true, content: 'changed\r\nsecond\nthird\n' });
  });

  it.each([
    {},
    { old_string: 'source' },
    { edits: [] },
    { edits: [{ old_string: 'source', new_string: null }] },
    { edits: [{ old_string: '', new_string: 'new' }] },
    { edits: [{ old_string: 'source', new_string: 'new' }], old_string: 'source', new_string: 'different' },
    { old_string: 'source', new_string: 'new', replace_all: 'false' },
  ])('rejects malformed requests rather than guessing a replacement: %j', (args) => {
    expect(parseTextEditRequest(args)).toMatchObject({ ok: false });
  });

  it('keeps legacy aliases and replace_all semantics without interpreting replacement text', () => {
    const parsed = parseTextEditRequest({ old_text: 'aa', new_text: '$&', replace_all: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(applyTextEdits('aaaaa', parsed.request, 'source.ts')).toEqual({ ok: true, content: '$&$&a' });
  });
});
