import { Folders } from 'lucide-react';
import { IconButton } from './button.js';
import { cn } from './utils.js';

/** One persistent toolbar control owns both states of a file navigator. */
export function FileTreeToggle({ expanded, label, className, onToggle }: {
  expanded: boolean;
  label: string;
  className?: string;
  onToggle(): void;
}) {
  return (
    <IconButton
      className={cn(className, expanded && 'is-active')}
      label={label}
      aria-expanded={expanded}
      aria-pressed={expanded}
      onClick={onToggle}
    >
      <Folders size={16} />
    </IconButton>
  );
}
