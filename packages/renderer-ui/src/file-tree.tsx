import { ChevronRight, File } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { forwardRef, useId, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { SPRING_LAYOUT } from './motion.js';
import { cn } from './utils.js';

const iconSpring = { type: 'spring', stiffness: 460, damping: 30, mass: 0.55 } as const;
type SurfaceProps = Omit<HTMLAttributes<HTMLDivElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'>;

/** Shared beUI file-tree presentation; each feature retains its own loading and actions. */
export const FileTreeSurface = forwardRef<HTMLDivElement, SurfaceProps>(function FileTreeSurface({ className, ...props }, ref) {
  const id = useId();
  return <LayoutGroup id={id}>
    {/* Tab slots remount the tree: restore existing rows in place; animate later directory additions. */}
    <AnimatePresence initial={false}>
      <motion.div {...props} ref={ref} layoutScroll className={cn('sd-file-tree', className)} />
    </AnimatePresence>
  </LayoutGroup>;
});

type FileTreeRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  depth: number;
  expanded?: boolean;
  selected?: boolean;
  /** Files have a default icon; directories omit it. null removes the icon slot. */
  icon?: ReactNode;
  label: ReactNode;
  extra?: ReactNode;
};

export const FileTreeRow = forwardRef<HTMLButtonElement, FileTreeRowProps>(function FileTreeRow({
  depth, expanded, selected = false, icon, label, extra, className, style, disabled, ...props
}, ref) {
  const reduce = useReducedMotion();
  const directory = expanded !== undefined;
  const rowIcon = icon === undefined ? (directory ? null : <File size={16} />) : icon;
  return <motion.div className="sd-file-tree__node" layout={reduce ? false : 'position'}
    initial={reduce ? false : { opacity: 0, y: -6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ layout: SPRING_LAYOUT, opacity: { duration: reduce ? 0 : 0.22 }, y: { duration: reduce ? 0 : 0.22 } }}>
    <button {...props} ref={ref} type={props.type ?? 'button'} disabled={disabled}
      aria-expanded={expanded} aria-current={selected ? 'true' : undefined}
      className={cn('sd-file-tree__row', selected && 'is-selected', className)}
      style={{ '--sd-file-tree-depth': depth, ...style } as CSSProperties}>
      {selected ? <motion.span aria-hidden="true" className="sd-file-tree__selection" layoutId="selection"
        initial={false} transition={reduce ? { duration: 0 } : SPRING_LAYOUT} /> : null}
      {depth > 0 ? <motion.span aria-hidden="true" className="sd-file-tree__branch"
        initial={reduce ? false : { opacity: 0, scaleY: 0 }} animate={{ opacity: 1, scaleY: 1 }}
        transition={{ duration: reduce ? 0 : 0.3, ease: 'easeOut' }} /> : null}
      {directory ? <motion.span aria-hidden="true" className="sd-file-tree__chevron"
        animate={{ rotate: expanded ? 90 : 0 }} transition={reduce ? { duration: 0 } : iconSpring}>
        <ChevronRight size={14} />
      </motion.span> : null}
      {rowIcon != null ? <span aria-hidden="true" className="sd-file-tree__icon">
        {rowIcon}
      </span> : null}
      <span className="sd-file-tree__label">{label}</span>
      {extra ? <span className="sd-file-tree__extra">{extra}</span> : null}
    </button>
  </motion.div>;
});
