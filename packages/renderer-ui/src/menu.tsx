import { Slot, ContextMenu, DropdownMenu } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import { forwardRef, useEffect, useRef, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { floatingPlacement, overlayContainer, type Placement } from './portal.js';
import { cn } from './utils.js';

export type MenuAction = { key: string; domEvent: Event };
export type MenuItem = {
  key?: string; type?: 'divider' | 'group'; label?: ReactNode; icon?: ReactNode;
  className?: string; extra?: ReactNode; danger?: boolean; disabled?: boolean; children?: (MenuItem | null | false)[];
  onClick?(action: MenuAction): void;
};
export type MenuProps = {
  items?: (MenuItem | null | false)[];
  selectedKeys?: string[];
  onClick?(action: MenuAction): void;
};
export type DropdownProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  children: ReactElement;
  menu: MenuProps;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  placement?: Placement;
  trigger?: ('click' | 'contextMenu')[];
  className?: string;
  rootClassName?: string;
  align?: { offset?: number[] };
  popupRender?(menu: ReactNode): ReactNode;
};

/** beUI menu presentation; Radix supplies nested menus, roving focus and typeahead. */
export const Dropdown = forwardRef<HTMLElement, DropdownProps>(function Dropdown({ children, menu, disabled, open, onOpenChange, placement, trigger, rootClassName, className, align, popupRender, ...triggerProps }, ref) {
  const context = trigger?.includes('contextMenu') ?? false;
  const rows = <MenuItems menu={menu} context={context} />;
  const contents = popupRender ? popupRender(rows) : rows;
  const classes = cn('sd-menu', rootClassName, className);
  if (context) return <ContextMenu.Root onOpenChange={onOpenChange} modal={false}>
    <ContextMenu.Trigger asChild disabled={disabled}><Slot.Root {...triggerProps} ref={ref}>{children}</Slot.Root></ContextMenu.Trigger>
    <ContextMenu.Portal container={overlayContainer()}><ContextMenu.Content className={classes} collisionPadding={8}>{contents}</ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>;
  return <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
    <DropdownMenu.Trigger asChild disabled={disabled}><Slot.Root {...triggerProps} ref={ref}>{children}</Slot.Root></DropdownMenu.Trigger>
    <DropdownMenu.Portal container={overlayContainer()}>
      <DropdownMenu.Content {...floatingPlacement(placement)} sideOffset={align?.offset?.[1] ?? 6} alignOffset={align?.offset?.[0]} collisionPadding={8} className={classes}>{contents}</DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
});

function MenuItems({ menu, context }: { menu: MenuProps; context: boolean }) {
  const ui = context ? ContextMenu : DropdownMenu;
  return <>{menu.items?.map((item, index) => {
    if (!item) return null;
    const key = item.key ?? String(index);
    if (item.type === 'divider') return <ui.Separator key={key} className="sd-menu__separator" />;
    if (item.type === 'group') return <ui.Group key={key}><ui.Label className="sd-menu__label">{item.label}</ui.Label><MenuItems context={context} menu={{ ...menu, items: item.children }} /></ui.Group>;
    const selected = menu.selectedKeys?.includes(key);
    const content = <>
      {item.icon ? <span className="sd-menu__icon">{item.icon}</span> : null}
      <span className="sd-menu__text">{item.label}</span>
      {item.extra ?? (selected ? <Check size={14} className="sd-menu__extra" /> : null)}
    </>;
    if (item.children) return <ui.Sub key={key}>
      <ui.SubTrigger disabled={item.disabled} className={cn('sd-menu__item', item.className)}>{content}<ChevronRight size={13} /></ui.SubTrigger>
      <ui.Portal container={overlayContainer()}><ui.SubContent className="sd-menu" sideOffset={4} collisionPadding={8}><MenuItems context={context} menu={{ ...menu, items: item.children }} /></ui.SubContent></ui.Portal>
    </ui.Sub>;
    return <ui.Item key={key} className={cn('sd-menu__item', item.className, selected && 'is-selected', item.danger && 'is-danger')} disabled={item.disabled}
      onSelect={(event) => { const action = { key, domEvent: event }; item.onClick?.(action); menu.onClick?.(action); }}>{content}</ui.Item>;
  })}</>;
}

/** Electron file and editor surfaces report viewport coordinates instead of a DOM trigger. */
export function PointMenu({ x, y, menu, onClose }: { x: number; y: number; menu: MenuProps; onClose(): void }) {
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    window.addEventListener('resize', onClose);
    return () => window.removeEventListener('resize', onClose);
  }, [onClose]);
  const container = overlayContainer();
  if (!container) return null;
  return createPortal(
    <DropdownMenu.Root open onOpenChange={(open) => { if (!open) onClose(); }} modal={false}>
      <DropdownMenu.Trigger asChild>
        <span aria-hidden="true" tabIndex={-1} style={{ position: 'fixed', left: x, top: y, width: 0, height: 0 }} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content className="sd-menu" align="start" sideOffset={2} collisionPadding={8}
          onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus({ preventScroll: true }); }}>
          <MenuItems menu={menu} context={false} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>, container,
  );
}
