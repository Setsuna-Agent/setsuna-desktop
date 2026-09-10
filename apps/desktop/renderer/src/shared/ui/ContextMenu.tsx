import { Dropdown, type DropdownProps } from 'antd';

type ContextMenuProps = Pick<DropdownProps, 'align' | 'children' | 'disabled' | 'menu' | 'onOpenChange' | 'placement' | 'trigger'>;

/** Use the workspace context-menu skin for both the root popup and portaled submenus. */
export function ContextMenu({ menu, ...props }: ContextMenuProps) {
  return (
    <Dropdown
      {...props}
      rootClassName="sd-context-dropdown"
      menu={{ ...menu, rootClassName: ['sd-context-dropdown', menu?.rootClassName].filter(Boolean).join(' ') }}
    />
  );
}
