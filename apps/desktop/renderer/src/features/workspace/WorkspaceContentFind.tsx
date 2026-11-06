import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ContentFindBar } from '../../shared/find/ContentFindBar.js';
import { ContentFindSourcesContext, type ContentFindSource } from '../../shared/find/contentFindSources.js';
import { revealContentFindRange } from '../../shared/find/revealContentFindRange.js';
import { useContentFind } from '../../shared/find/useContentFind.js';
import { CONTENT_FIND_REQUEST } from '../../shared/find/useContentFindTarget.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { DesktopPanelSlot } from './model.js';

export function WorkspaceContentFind({ children, placement }: { children: ReactNode; placement: DesktopPanelSlot }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [sources, setSources] = useState<readonly ContentFindSource[]>([]);
  const register = useCallback((source: ContentFindSource) => {
    setSources((current) => [...current, source]);
    return () => setSources((current) => current.filter((item) => item !== source));
  }, []);
  const close = useCallback(() => {
    for (const source of sources) source.find('');
    setFocusRequest(0);
  }, [sources]);

  useEffect(() => {
    const content = contentRef.current;
    const open = () => setFocusRequest((request) => request + 1);
    content?.addEventListener(CONTENT_FIND_REQUEST, open);
    return () => content?.removeEventListener(CONTENT_FIND_REQUEST, open);
  }, []);

  return <ContentFindSourcesContext.Provider value={register}>
    <div className="content-find-scope" data-content-find-scope={placement} ref={contentRef} tabIndex={-1}>
      {children}
      {focusRequest ? <WorkspaceFindBar contentRef={contentRef} focusRequest={focusRequest} sources={sources} onClose={close} /> : null}
    </div>
  </ContentFindSourcesContext.Provider>;
}

function WorkspaceFindBar({ contentRef, focusRequest, sources, onClose }: {
  contentRef: RefObject<HTMLDivElement | null>;
  focusRequest: number;
  sources: readonly ContentFindSource[];
  onClose(): void;
}) {
  const { t } = useI18n();
  const onRevealRange = useCallback((range: Range) => {
    if (contentRef.current) revealContentFindRange(range, contentRef.current);
  }, [contentRef]);
  const find = useContentFind({ contentRef, onRevealRange, sources });
  return <ContentFindBar placeholder={t('workspace.find.placeholder')} fallbackFocusRef={contentRef}
    focusRequest={focusRequest} onClose={onClose} query={find.query} onQueryChange={find.setQuery}
    current={find.current} total={find.total} onMove={find.move} />;
}
