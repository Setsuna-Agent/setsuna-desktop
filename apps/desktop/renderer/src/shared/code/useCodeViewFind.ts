import type { CodeViewHandle } from '@pierre/diffs/react';
import { useCallback, useMemo, useState, type RefObject } from 'react';
import { useContentFindSource } from '../find/contentFindSources.js';
import { codeFileFindLines, createCodeFindSource } from './codeFindSource.js';

export function useCodeViewFind(
  codeViewRef: RefObject<CodeViewHandle<undefined> | null>,
  itemId: string,
  contents: string,
) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const source = useMemo(() => element ? createCodeFindSource(element, () => codeFileFindLines(contents), (position) => {
    codeViewRef.current?.scrollTo({
      type: 'line', id: itemId, lineNumber: position.line, align: 'center', behavior: 'instant',
    });
  }) : null, [codeViewRef, contents, element, itemId]);
  useContentFindSource(source);
  return useCallback((container: HTMLDivElement | null) => setElement(container), []);
}
