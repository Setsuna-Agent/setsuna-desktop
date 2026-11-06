import { createContext, useContext, useEffect } from 'react';
import { composedParent } from './revealContentFindRange.js';

export type ContentFindMatch = {
  key: string;
  element: HTMLElement;
  getRanges(): Range[];
  reveal?(): void;
};

/** Virtualized surfaces search their data and resolve DOM ranges after navigation. */
export type ContentFindSource = {
  element: HTMLElement;
  find(query: string): ContentFindMatch[];
};

export const ContentFindSourcesContext = createContext<((source: ContentFindSource) => () => void) | null>(null);

export function useContentFindSource(source: ContentFindSource | null) {
  const register = useContext(ContentFindSourcesContext);
  useEffect(() => source && register ? register(source) : undefined, [register, source]);
}

const nodeKeys = new WeakMap<Node, number>();
let nextNodeKey = 0;

export function contentFindNodeKey(node: Node): number {
  let key = nodeKeys.get(node);
  if (key === undefined) {
    key = nextNodeKey++;
    nodeKeys.set(node, key);
  }
  return key;
}

export function literalFindExpression(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
}

export function compareContentFindElements(a: HTMLElement, b: HTMLElement): number {
  if (a === b) return 0;
  const ancestors = (element: HTMLElement) => {
    const path = [element];
    let parent = composedParent(element);
    while (parent) { path.push(parent); parent = composedParent(parent); }
    return path;
  };
  const left = ancestors(a);
  const right = ancestors(b);
  while (left.length && right.length && left.at(-1) === right.at(-1)) {
    left.pop();
    right.pop();
  }
  if (!left.length || !right.length) return left.length ? 1 : -1;
  return left.at(-1)!.compareDocumentPosition(right.at(-1)!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}
