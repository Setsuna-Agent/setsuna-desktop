// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findChatTextRanges } from '../../../../../../src/features/chat/conversation/search/chatFindMatches.js';

const inlineDefaults = document.createElement('style');
beforeEach(() => {
  // happy-dom omits the browser's computed initial display for inline elements.
  inlineDefaults.textContent = 'span, strong, code { display: inline; }';
  document.head.append(inlineDefaults);
});
afterEach(() => { document.body.replaceChildren(); inlineDefaults.remove(); });

describe('conversation text matching', () => {
  it('matches literal case-insensitive text across inline formatting without losing Unicode offsets', () => {
    const root = content('<p>İ 前缀 <strong>Sl</strong>ot a+b [x] slot</p><p>sl</p><p>ot</p>');
    const matches = findChatTextRanges(root, 'slot');
    expect(matches.map((range) => range.toString())).toEqual(['Slot', 'slot']);
    expect(findChatTextRanges(root, 'a+b [x]').map((range) => range.toString())).toEqual(['a+b [x]']);
    expect(findChatTextRanges(root, '')).toEqual([]);
  });

  it('limits results to the content root and searchable, expanded text', () => {
    const root = content('<p>needle</p><button>needle</button><input value="needle"><div hidden>needle</div><div style="display:none">needle</div><details><summary>needle</summary><p>needle hidden</p></details>');
    document.body.append(document.createTextNode('needle outside'));
    expect(findChatTextRanges(root, 'needle')).toHaveLength(2);
    root.querySelector('details')!.open = true;
    expect(findChatTextRanges(root, 'needle')).toHaveLength(3);
  });

  it('includes syntax-highlighted code inside open shadow roots and exposes roots for live observation', () => {
    const root = content('<p>first</p><diffs-container></diffs-container>');
    const shadow = root.querySelector('diffs-container')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>span, code { display: inline; } /* needle */</style><pre><code><span>nee</span><span>dle</span></code></pre>';
    const observed: ShadowRoot[] = [];
    const ranges = findChatTextRanges(root, 'needle', (value) => observed.push(value));
    expect(ranges.map((range) => range.toString())).toEqual(['needle']);
    expect(observed).toEqual([shadow]);
  });
});

function content(html: string): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}
