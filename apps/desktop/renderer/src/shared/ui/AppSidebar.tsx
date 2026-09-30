import type { ComponentPropsWithoutRef } from 'react';

export function AppSidebar({
  as: Element = 'aside',
  className = '',
  children,
  ...props
}: ComponentPropsWithoutRef<'aside'> & { as?: 'aside' | 'nav' }) {
  return (
    <div className="app-sidebar-slot">
      <Element {...props} className={`app-sidebar ${className}`}>
        {children}
      </Element>
    </div>
  );
}
