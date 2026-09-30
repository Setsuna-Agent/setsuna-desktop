import { forwardRef, type ButtonHTMLAttributes } from 'react';

type AutomationSidebarRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> & {
  title: string;
  detail: string;
  active: boolean;
  tooltip?: string;
};

/** Both lists share one presentation; forward trigger props/ref for the task context menu. */
export const AutomationSidebarRow = forwardRef<HTMLButtonElement, AutomationSidebarRowProps>(function AutomationSidebarRow({
  title, detail, active, tooltip, className, ...buttonProps
}, ref) {
  return (
    <button {...buttonProps} ref={ref} type="button" title={tooltip}
      className={['automation-sidebar-row', active ? 'is-active' : '', className].filter(Boolean).join(' ')}>
      <span className="automation-sidebar-row__title">{title}</span>
      <span className="automation-sidebar-row__detail">{detail}</span>
    </button>
  );
});
