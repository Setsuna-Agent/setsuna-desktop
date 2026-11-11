import { ChevronRight } from 'lucide-react';
import { Fragment, useCallback, useRef, useState, type ReactNode, type RefCallback } from 'react';
import { Button } from '../button.js';
import { Popover } from '../popover.js';

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
  const segment = (name: string, index: number, current: boolean) => {
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
        aria-current={current ? 'page' : undefined} title={current ? path : directory || rootLabel}>
        <span>{name}</span>
      </Button>
    </Popover>;
  };
  return <nav className="sd-file-breadcrumb" aria-label={label}>
    {rootLabel || parts.length > 1 ? <span className="sd-file-breadcrumb__parents"><span className="sd-file-breadcrumb__segments">
      {rootLabel ? <>{segment(rootLabel, -1, false)}{parts.length ? <ChevronRight aria-hidden="true" size={12} /> : null}</> : null}
      {parts.slice(0, -1).map((name, index) => <Fragment key={parts.slice(0, index + 1).join('/')}>
        {segment(name, index, false)}<ChevronRight aria-hidden="true" size={12} />
      </Fragment>)}
    </span></span> : null}
    {parts.length ? segment(parts.at(-1)!, parts.length - 1, true) : null}
  </nav>;
}
