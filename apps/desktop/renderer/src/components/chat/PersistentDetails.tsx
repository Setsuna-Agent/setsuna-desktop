import type { MouseEvent, ReactNode, SyntheticEvent } from 'react';

export function PersistentDetails({
  children,
  className,
  open,
  summary,
  summaryClassName,
  onOpenChange,
}: {
  children: ReactNode;
  className: string;
  open: boolean;
  summary: ReactNode;
  summaryClassName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const handleSummaryClick = (event: MouseEvent<HTMLElement>) => {
    // Native <details> toggles after the click event. Taking control here records the
    // user's choice before a concurrent streaming render can restore the old `open` prop.
    event.preventDefault();
    onOpenChange(!open);
  };
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    // Keep keyboard/accessibility initiated native toggles in sync as a fallback.
    const nextOpen = event.currentTarget.open;
    if (nextOpen !== open) onOpenChange(nextOpen);
  };

  return (
    <details className={className} open={open} onToggle={handleToggle}>
      <summary className={summaryClassName} onClick={handleSummaryClick}>
        {summary}
      </summary>
      {children}
    </details>
  );
}
