import { createContext, useContext, useMemo, type HTMLAttributes } from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import { markdownComponents, rehypePlugins, remarkPlugins } from '../markdown/MarkdownContentBlock.js';
import { markdownUrlTransform } from '../markdown/markdownLinks.js';
import { repairStreamingMarkdown } from '../markdown/streamingMarkdown.js';
import { useSmoothedStreamingContent } from '../markdown/useSmoothedStreamingContent.js';
import { OpenUiBlock } from './OpenUiBlock.js';
import type { OpenUiContentPart } from './openUiContent.js';

type UiPart = Extract<OpenUiContentPart, { kind: 'openui' }>;
type Element = NonNullable<ExtraProps['node']>;
type Root = { type: 'root'; children: Element['children'] };
type DocumentState = { blocks: UiPart[]; streaming: boolean };

const DocumentContext = createContext<DocumentState>({ blocks: [], streaming: false });
const components = { ...markdownComponents, div: DocumentBlock };

/** Resolve references and footnotes in one tree, then separate the display scopes. */
export function OpenUiMarkdownDocument({ content, parts, streaming }: {
  content: string;
  parts: OpenUiContentPart[];
  streaming: boolean;
}) {
  const blocks = useMemo(() => parts.filter((part): part is UiPart => part.kind === 'openui'), [parts]);
  const state = useMemo(() => ({ blocks, streaming }), [blocks, streaming]);
  const tail = parts.at(-1)?.content ?? '';
  const visibleTail = useSmoothedStreamingContent(tail, streaming);
  const source = content.replace(/\r\n?/g, '\n');
  // Repair only prose. Synthetic closers must never complete an OpenUI program.
  const visibleSource = streaming
    ? source.slice(0, source.length - tail.length) + repairStreamingMarkdown(visibleTail)
    : source;
  const plugins = useMemo(() => [
    ...rehypePlugins,
    () => (tree: Root) => separateDisplayScopes(tree, blocks),
  ], [blocks]);

  return (
    <DocumentContext.Provider value={state}>
      <ReactMarkdown components={components} rehypePlugins={plugins} remarkPlugins={remarkPlugins}
        skipHtml urlTransform={markdownUrlTransform}>
        {visibleSource}
      </ReactMarkdown>
    </DocumentContext.Provider>
  );
}

function DocumentBlock({ node, children, ...props }: HTMLAttributes<HTMLDivElement> & ExtraProps) {
  const { blocks, streaming } = useContext(DocumentContext);
  const index = node?.properties.dataOpenuiBlock;
  const block = typeof index === 'number' ? blocks[index] : undefined;
  if (block) return <OpenUiBlock code={block.content} streaming={streaming && !block.closed} />;
  return <div {...props}>{children}</div>;
}

function separateDisplayScopes(tree: Root, blocks: UiPart[]): void {
  const indices = new Map(blocks.map((block, index) => [block.offset, index]));
  const children: Element['children'] = [];
  let prose: Element['children'] = [];
  const flush = () => {
    // Keep even empty groups so appending prose/definitions preserves interactive block keys.
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
