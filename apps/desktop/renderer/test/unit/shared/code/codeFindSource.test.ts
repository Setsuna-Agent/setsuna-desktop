// @vitest-environment happy-dom
import { getSingularPatch } from '@pierre/diffs';
import { afterEach, expect, it, vi } from 'vitest';
import { codeDiffFindLines, codeFileFindLines, createCodeFindSource } from '../../../../src/shared/code/codeFindSource.js';

afterEach(() => document.body.replaceChildren());

it('finds literal Unicode offsets in unmounted file lines and resolves syntax-split ranges after rendering', () => {
  const host = surface();
  const reveal = vi.fn();
  const source = createCodeFindSource(host, () => codeFileFindLines('first\nİ 😀 SlOt [x]\nlast slot'), reveal);
  const matches = source.find('slot');
  expect(matches).toHaveLength(2);
  expect(matches[0].getRanges()).toEqual([]);
  matches[0].reveal?.();
  expect(reveal).toHaveBeenLastCalledWith(expect.objectContaining({ line: 2, start: 5, end: 9 }));
  host.shadowRoot!.innerHTML = '<div data-line="2" data-line-type="context">İ 😀 <span>Sl</span><span>Ot</span> [x]</div>';
  expect(source.find('slot')[0].getRanges().map((range) => range.toString())).toEqual(['SlOt']);
  expect(source.find('[x]')[0].getRanges().map((range) => range.toString())).toEqual(['[x]']);
});

it('indexes diff hunks using old/new coordinates, counting split context once while preserving both highlights', () => {
  const diff = getSingularPatch('diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -10,3 +20,3 @@\n shared needle\n-old needle\n+new needle\n end\n@@ -100,1 +110,2 @@\n last needle\n+later needle\n');
  const host = surface();
  host.shadowRoot!.innerHTML = '<code data-deletions><div data-line="10" data-line-type="context">shared needle</div><div data-line="11" data-line-type="change-deletion">old needle</div></code><code data-additions><div data-line="20" data-line-type="context">shared needle</div><div data-line="21" data-line-type="change-addition">new needle</div></code>';
  const reveal = vi.fn();
  const source = createCodeFindSource(host, () => codeDiffFindLines(diff), reveal);
  const matches = source.find('needle');
  expect(matches).toHaveLength(5);
  expect(matches[0].getRanges().map((range) => range.toString())).toEqual(['needle', 'needle']);
  expect(matches[1].getRanges().map((range) => range.toString())).toEqual(['needle']);
  expect(matches[2].getRanges().map((range) => range.toString())).toEqual(['needle']);
  for (const match of matches) match.reveal?.();
  expect(reveal.mock.calls.map(([position]) => [position.line, position.side])).toEqual([
    [20, 'additions'], [11, 'deletions'], [21, 'additions'], [110, 'additions'], [111, 'additions'],
  ]);
});

function surface() {
  const host = document.createElement('diffs-container');
  if (!host.shadowRoot) host.attachShadow({ mode: 'open' });
  document.body.append(host);
  return host;
}
