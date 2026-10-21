import { Folders } from 'lucide-react';
import { IconButton } from './button.js';
import { Tooltip } from './popover.js';
import { cn } from './utils.js';

/** One persistent toolbar control owns both states of a file navigator. */
export function FileTreeToggle({ expanded, label, className, tooltip = false, onToggle }: {
  expanded: boolean;
  label: string;
  className?: string;
  tooltip?: boolean;
  onToggle(): void;
}) {
  const button = (
    <IconButton
      className={cn(className, expanded && 'is-active')}
      label={label}
      title={tooltip ? '' : label}
      aria-expanded={expanded}
      aria-pressed={expanded}
      onClick={onToggle}
    >
      <Folders size={16} />
    </IconButton>
  );
  return tooltip ? <Tooltip title={label} placement="top">{button}</Tooltip> : button;
}
