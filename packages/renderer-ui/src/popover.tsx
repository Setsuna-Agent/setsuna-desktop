import { Slot, HoverCard, Popover as Primitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { forwardRef, useEffect, useState, type HTMLAttributes, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { floatingPlacement, overlayContainer, type Placement } from './portal.js';
import { cn } from './utils.js';

export type PopoverProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'content'> & {
  children: ReactElement; content: ReactNode; open?: boolean; onOpenChange?(open: boolean): void;
  trigger?: 'click' | 'hover'; placement?: Placement; className?: string; style?: CSSProperties;
  mouseEnterDelay?: number; mouseLeaveDelay?: number;
};
export const Popover = forwardRef<HTMLElement, PopoverProps>(function Popover({ children, content, open, onOpenChange, trigger = 'click', placement, className, style, mouseEnterDelay = 0.15, mouseLeaveDelay = 0.15, ...triggerProps }, ref) {
  const panel = { ...floatingPlacement(placement), className: cn('sd-popover', className), style, sideOffset: 6, collisionPadding: 8 };
  if (trigger === 'hover') return <HoverCard.Root open={open} onOpenChange={onOpenChange} openDelay={mouseEnterDelay * 1000} closeDelay={mouseLeaveDelay * 1000}>
    <HoverCard.Trigger asChild><Slot.Root {...triggerProps} ref={ref}>{children}</Slot.Root></HoverCard.Trigger>
    <HoverCard.Portal container={overlayContainer()}><HoverCard.Content {...panel} hideWhenDetached>{content}</HoverCard.Content></HoverCard.Portal>
  </HoverCard.Root>;
  return <Primitive.Root open={open} onOpenChange={onOpenChange}>
    <Primitive.Trigger asChild><Slot.Root {...triggerProps} ref={ref}>{children}</Slot.Root></Primitive.Trigger>
    <Primitive.Portal container={overlayContainer()}><Primitive.Content {...panel}>{content}</Primitive.Content></Primitive.Portal>
  </Primitive.Root>;
});

export type TooltipProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> & { children: ReactElement; title: ReactNode; open?: boolean; disabled?: boolean; mouseEnterDelay?: number; placement?: Placement; className?: string };
export const Tooltip = forwardRef<HTMLElement, TooltipProps>(function Tooltip({ children, title, open, disabled = false, mouseEnterDelay = 0.18, placement = 'top', className, ...triggerProps }, ref) {
  const [hoverOpen, setHoverOpen] = useState(false);
  // Suppress the popup without remounting a nested menu or restoring a stale hover later.
  useEffect(() => { if (disabled || !title) setHoverOpen(false); }, [disabled, title]);
  if (!title) return <Slot.Root {...triggerProps} ref={ref}>{children}</Slot.Root>;
  return <TooltipPrimitive.Provider delayDuration={mouseEnterDelay * 1000}><TooltipPrimitive.Root open={!disabled && (open ?? hoverOpen)} onOpenChange={(next) => setHoverOpen(!disabled && next)}>
    <TooltipPrimitive.Trigger asChild><Slot.Root {...triggerProps} ref={ref}>{children}</Slot.Root></TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal container={overlayContainer()}><TooltipPrimitive.Content {...floatingPlacement(placement)} sideOffset={6} collisionPadding={8} className={cn('sd-tooltip', className)}>{title}</TooltipPrimitive.Content></TooltipPrimitive.Portal>
  </TooltipPrimitive.Root></TooltipPrimitive.Provider>;
});
