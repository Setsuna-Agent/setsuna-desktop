import { CollapsibleContent } from '@setsuna-desktop/renderer-ui';
import type { ReactNode } from 'react';

export function SidebarCollapsibleContent({ open, children }: {
  open: boolean;
  children: ReactNode;
}) {
  return (
    // 外层立即停用交互；内层保留内容到退场结束，让快捷键跳过正在收起的分组。
    <div aria-hidden={!open || undefined} {...{ inert: open ? undefined : '' }}>
      <CollapsibleContent open={open}>{children}</CollapsibleContent>
    </div>
  );
}
