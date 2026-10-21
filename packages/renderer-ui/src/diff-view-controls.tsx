import { Columns2, WrapText } from 'lucide-react';
import { IconButton } from './button.js';
import { Tooltip } from './popover.js';
import type { Placement } from './portal.js';
import { cn } from './utils.js';

/** Shared display controls for local changes and remote PR diffs. */
export function DiffViewControls({ layout, wrap, layoutLabel, wrapLabel, className, disabled, tooltipPlacement = 'bottomRight', onLayoutChange, onWrapChange }: {
  layout: 'unified' | 'split';
  wrap: boolean;
  layoutLabel: string;
  wrapLabel: string;
  className?: string;
  disabled?: boolean;
  tooltipPlacement?: Placement;
  onLayoutChange(layout: 'unified' | 'split'): void;
  onWrapChange(wrap: boolean): void;
}) {
  return <>
    <Tooltip title={layoutLabel} placement={tooltipPlacement}>
      <IconButton className={cn(className, layout === 'split' && 'is-active')} disabled={disabled} label={layoutLabel} title="" aria-pressed={layout === 'split'} onClick={() => onLayoutChange(layout === 'split' ? 'unified' : 'split')}>
        <Columns2 size={15} />
      </IconButton>
    </Tooltip>
    <Tooltip title={wrapLabel} placement={tooltipPlacement}>
      <IconButton className={cn(className, wrap && 'is-active')} disabled={disabled} label={wrapLabel} title="" aria-pressed={wrap} onClick={() => onWrapChange(!wrap)}>
        <WrapText size={15} />
      </IconButton>
    </Tooltip>
  </>;
}
