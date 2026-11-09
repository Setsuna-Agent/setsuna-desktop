import type { ExtraProps } from 'react-markdown';
import type { OpenUiContentPart } from './openUiContent.js';

type Element = NonNullable<ExtraProps['node']>;
export type OpenUiMarkdownRoot = { type: 'root'; children: Element['children'] };

/** Keep one Markdown document for references while isolating top-level display blocks. */
export function separateOpenUiDisplayScopes(tree: OpenUiMarkdownRoot, blocks: Extract<OpenUiContentPart, { kind: 'openui' }>[]): void {
  const indices = new Map(blocks.map((block, index) => [block.offset, index]));
  const children: Element['children'] = [];
  let prose: Element['children'] = [];
  const flush = () => {
    // Empty scopes keep interactive block keys stable when prose is appended.
    children.push({ type: 'element', tagName: 'div', properties: { className: ['chat-markdown'] }, children: prose });
    prose = [];
  };
  for (const node of tree.children) {
    const index = node.type === 'element' && node.tagName === 'pre'
      ? indices.get(node.position?.start.offset ?? -1) : undefined;
    if (index === undefined) {
      prose.push(node);
      continue;
    }
    flush();
    children.push({ type: 'element', tagName: 'div', properties: { dataOpenuiBlock: index }, children: [] });
  }
  flush();
  tree.children = children;
}
