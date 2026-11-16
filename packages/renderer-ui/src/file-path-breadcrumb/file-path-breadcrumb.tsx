import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefCallback } from 'react';
import { Button } from '../button.js';
import { Popover } from '../popover.js';
import { useCollapsedBreadcrumb } from './useCollapsedBreadcrumb.js';

export type FilePathDirectoryProps = {
  directory: string;
  selectedRef: RefCallback<HTMLButtonElement>;
  close(): void;
};

/** Shared path navigation; each owner supplies its own directory data and file actions. */
export function FilePathBreadcrumb({ path, label, rootLabel, disabled, renderDirectory }: {
  path: string;
  label: string;
  rootLabel?: string;
  disabled?: boolean;
  renderDirectory(props: FilePathDirectoryProps): ReactNode;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const selectedRef = useCallback((button: HTMLButtonElement | null) => {
    selectedButton.current = button;
    // Async directories may arrive after opening; don't steal focus once the user has moved it.
    if (button && button.closest('[role="dialog"]') === document.activeElement) {
      button.focus({ preventScroll: true });
      button.scrollIntoView?.({ block: 'nearest' });
    }
  }, []);
  const parts = path.split(/[\\/]+/u).filter(Boolean);
  const parents = [
    ...(rootLabel ? [{ name: rootLabel, index: -1 }] : []),
    ...parts.slice(0, -1).map((name, index) => ({ name, index })),
  ];
  const { rootRef, measureRef, hiddenCount } = useCollapsedBreadcrumb(JSON.stringify([rootLabel, path]), parents.length);
  const firstVisibleIndex = hiddenCount - (rootLabel ? 1 : 0);
  useEffect(() => {
    // A resized-away directory must not reopen its old popup when space returns.
    if (openIndex !== null && openIndex >= 0 && openIndex < firstVisibleIndex) setOpenIndex(null);
  }, [firstVisibleIndex, openIndex]);
  const hiddenPath = parents.slice(0, hiddenCount).map(({ name }) => name).join(' / ');
  const segment = (name: string, index: number, current: boolean, collapsed = false) => {
    const directory = parts.slice(0, current ? index : index + 1).join('/');
    return <Popover open={!disabled && openIndex === index} onOpenChange={(open) => setOpenIndex(open ? index : null)}
      placement="bottomLeft" className="sd-menu-surface sd-menu-surface--neutral sd-file-breadcrumb__popover"
      contentLabel={directory || label}
      onOpenAutoFocus={(event) => {
        const selected = selectedButton.current;
        if (!selected) return;
        event.preventDefault();
        selected.focus({ preventScroll: true });
        selected.scrollIntoView?.({ block: 'nearest' });
      }}
      content={!disabled && openIndex === index ? <div className="sd-file-breadcrumb__tree" key={directory}>
        {renderDirectory({ directory, selectedRef, close: () => setOpenIndex(null) })}
      </div> : null}>
      <Button variant="ghost" size="small" disabled={disabled}
        className={'sd-file-breadcrumb__segment' + (current ? ' is-current' : '')}
        aria-current={current ? 'page' : undefined} aria-label={collapsed ? hiddenPath : undefined}
        title={collapsed ? hiddenPath : current ? path : directory || rootLabel}>
        <span>{name}</span>
      </Button>
    </Popover>;
  };
  return <nav ref={rootRef} className="sd-file-breadcrumb" aria-label={label}>
    {/* The inert full path preserves intrinsic width after visible ancestors collapse. */}
    <span ref={measureRef} className="sd-file-breadcrumb__measure" aria-hidden="true">
      <span className="sd-file-breadcrumb__parent sd-file-breadcrumb__ellipsis-measure">
        <Button variant="ghost" size="small" disabled className="sd-file-breadcrumb__segment"><span>…</span></Button>
        {parts.length ? <ChevronRight size={12} /> : null}
      </span>
      {parents.map(({ name, index }) => <span className="sd-file-breadcrumb__parent" key={index}>
        <Button variant="ghost" size="small" disabled className="sd-file-breadcrumb__segment"><span>{name}</span></Button>
        {parts.length ? <ChevronRight size={12} /> : null}
      </span>)}
      {parts.length ? <Button variant="ghost" size="small" disabled className="sd-file-breadcrumb__segment is-current"><span>{parts.at(-1)}</span></Button> : null}
    </span>
    <span className="sd-file-breadcrumb__content">
      {hiddenCount ? <span className="sd-file-breadcrumb__parent">
        {segment('…', -1, false, true)}{parts.length ? <ChevronRight aria-hidden="true" size={12} /> : null}
      </span> : null}
      {parents.slice(hiddenCount).map(({ name, index }) => <span className="sd-file-breadcrumb__parent" key={index}>
        {segment(name, index, false)}{parts.length ? <ChevronRight aria-hidden="true" size={12} /> : null}
      </span>)}
      {parts.length ? segment(parts.at(-1)!, parts.length - 1, true) : null}
    </span>
  </nav>;
}
