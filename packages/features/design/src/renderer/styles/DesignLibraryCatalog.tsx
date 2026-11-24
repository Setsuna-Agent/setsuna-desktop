import { ArrowUpRight, Link2, Search, Unlink2 } from 'lucide-react';
import { useContext, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import type { RendererFeatureMessageKey, RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, IconButton, TextField, useToast } from '@setsuna-desktop/renderer-ui';
import { DesignUiHostContext } from '../context/design-ui-host.js';

export function LibraryScrollArea({ children, kind, scrollRef }: Readonly<{
  children: ReactElement;
  kind?: 'components' | 'styles' | 'libraries';
  scrollRef?: RefObject<HTMLDivElement>;
}>) {
  const localRef = useRef<HTMLDivElement>(null);
  const viewportRef = scrollRef ?? localRef;
  const ScrollOverlay = useContext(DesignUiHostContext)?.ScrollOverlay;
  return <div className="design-library__scroll-area">
    <div ref={viewportRef} className="design-library__viewport" data-kind={kind}>{children}</div>
    {ScrollOverlay ? <ScrollOverlay scrollRef={viewportRef} /> : null}
  </div>;
}

type LibraryCatalogItem = Readonly<{
  key: string;
  name: string;
  label?: string;
  linked: boolean;
  canOpen: boolean;
  thumbnail: ReactElement;
}>;

type LibraryAction<Item> = (item: Item, signal: AbortSignal) => void | Promise<unknown>;

export function DesignLibraryCatalog<Item extends LibraryCatalogItem>({ items, scrollRef, disabled, linkFailure = 'feature.design.loadFailed',
  onLink, onUnlink, onOpen, translate: t }: Readonly<{
  items: readonly Item[];
  scrollRef?: RefObject<HTMLDivElement>;
  disabled: boolean;
  linkFailure?: RendererFeatureMessageKey;
  onLink: LibraryAction<Item>;
  onUnlink: LibraryAction<Item>;
  onOpen?: LibraryAction<Item>;
  translate: RendererTranslate;
}>) {
  const toast = useToast();
  const request = useRef<AbortController>();
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => () => request.current?.abort(), []);
  const search = query.trim().toLowerCase();
  const searchLabel = t('feature.design.librarySearch');

  async function run(action: LibraryAction<Item>, item: Item, failure: RendererFeatureMessageKey) {
    if (disabled || request.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    request.current = controller;
    setPending(true);
    try {
      await action(item, signal);
    } catch (error) {
      if (!signal.aborted && !isFeatureOperationCancelled(error)) {
        toast.error(t(failure, { error: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      request.current = undefined;
      if (!signal.aborted) setPending(false);
    }
  }

  return <div className="design-library__catalog">
    <TextField aria-label={searchLabel} placeholder={searchLabel} value={query} disabled={disabled || pending}
      appearance="search" leadingIcon={<Search size={14} />} onChange={(event) => setQuery(event.target.value)} />
    <LibraryScrollArea kind="libraries" scrollRef={scrollRef}>
      <div className="design-library__source-grid" role="group" aria-label={t('feature.design.librarySource')}>
        {items.filter(({ label, name }) => (label ?? name).toLowerCase().includes(search)).map((item) =>
          <article key={item.key} className="design-library__source-card" aria-label={item.label ?? item.name}>
            {item.thumbnail}
            <div className="design-library__source-title">
              <h3 title={item.label ?? item.name}>{item.name}</h3>
              {item.linked ? <span className="design-library__source-linked" aria-hidden="true"><Link2 size={14} /></span> : null}
            </div>
            <footer className="design-library__source-actions">
              <Button size="small" variant={item.linked ? 'secondary' : 'primary'} disabled={disabled || pending}
                icon={item.linked ? <Unlink2 size={14} /> : <Link2 size={14} />}
                onClick={() => { void run(item.linked ? onUnlink : onLink, item, item.linked ? 'feature.design.saveFailed' : linkFailure); }}>
                {t(item.linked ? 'feature.design.unlinkLibrary' : 'feature.design.linkLibrary')}
              </Button>
              {item.canOpen && onOpen ? <IconButton size="small" variant="secondary" label={t('feature.design.openLibrarySource')}
                disabled={disabled || pending} onClick={() => { void run(onOpen, item, 'feature.design.loadFailed'); }}>
                <ArrowUpRight size={15} />
              </IconButton> : null}
            </footer>
          </article>)}
      </div>
    </LibraryScrollArea>
  </div>;
}
