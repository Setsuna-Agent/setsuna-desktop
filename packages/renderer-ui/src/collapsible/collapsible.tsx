// Adapted from beUI's Collapsible (MIT): https://beui.dev/components/motion/collapsible
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
  type HTMLMotionProps,
  type MotionProps,
  type Transition,
} from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';
import { EASE_OUT, SPRING_LAYOUT } from '../motion.js';

const REVEAL_TRANSITION: Transition = {
  gridTemplateRows: SPRING_LAYOUT,
  opacity: { duration: 0.2, ease: EASE_OUT },
};

// 收起用定时补间，避免接近折叠后还要等待弹簧收尾才能卸载。
const COLLAPSE_TRANSITION: Transition = {
  gridTemplateRows: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
  opacity: { duration: 0.12, ease: EASE_OUT },
};

const INSTANT_TRANSITION: Transition = { duration: 0 };

// 将内容的 padding/margin 留在可压缩轨道内，0fr 才能完全收拢。
const TRACK_STYLE: CSSProperties = { minHeight: 0, minWidth: 0 };

type CollapseMotionProps = Pick<MotionProps, 'animate' | 'exit' | 'initial' | 'style' | 'transition'>;

/**
 * 用网格轨道展开自然高度，避免 Motion 将缩放后的 DOMRect 当成 CSS 高度，
 * 在动画结束切回 auto 时突然增减空白。只在动画期间裁切溢出，
 * 静止展开时不裁掉子元素的焦点环和阴影。
 */
function useCollapseMotion(): CollapseMotionProps {
  const reduceMotion = useReducedMotion();
  return {
    style: { display: 'grid' },
    initial: { gridTemplateRows: '0fr', opacity: 0, overflow: 'hidden' },
    animate: { gridTemplateRows: '1fr', opacity: 1, transitionEnd: { overflow: 'visible' } },
    exit: {
      gridTemplateRows: '0fr',
      opacity: 0,
      overflow: 'hidden',
      transition: reduceMotion ? INSTANT_TRANSITION : COLLAPSE_TRANSITION,
    },
    transition: reduceMotion ? INSTANT_TRANSITION : REVEAL_TRANSITION,
  };
}

/** 单块内容的展开收起；收起动画结束后再卸载。 */
export function CollapsibleContent({ open, children, className, id, onExitComplete }: {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
  /** 收起动画结束、内容已卸载后触发。 */
  onExitComplete?: () => void;
}) {
  const collapseMotion = useCollapseMotion();
  return (
    <AnimatePresence initial={false} onExitComplete={onExitComplete}>
      {open ? (
        <motion.div key="collapsible-content" className={className} id={id} {...collapseMotion}>
          <div style={TRACK_STYLE}>{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** 列表增删的 presence 边界：直接子项须为带稳定 key 的 CollapsibleListItem。 */
export function CollapsibleList({ children, initial = false, onExitComplete }: {
  children: ReactNode;
  /** 挂载时已有的条目是否也播放入场；默认只对之后新增的条目播放。 */
  initial?: boolean;
  /** 所有退场条目收拢并卸载后触发。 */
  onExitComplete?: () => void;
}) {
  return (
    <AnimatePresence initial={initial} onExitComplete={onExitComplete}>
      {children}
    </AnimatePresence>
  );
}

/**
 * 列表条目沿用同一套网格高度展开 / 收起。可见行样式应放在子元素上，
 * li 的 opacity 由动画持有。退场期间节点保留到收拢完成，并设为 inert，
 * 避免对已移除的条目重复操作。
 */
export function CollapsibleListItem({ children, ...props }: Omit<HTMLMotionProps<'li'>, keyof CollapseMotionProps | 'children'> & {
  children: ReactNode;
}) {
  const collapseMotion = useCollapseMotion();
  const present = useIsPresent();
  return (
    <motion.li {...props} {...collapseMotion} {...{ inert: present ? undefined : '' }}>
      <div style={TRACK_STYLE}>{children}</div>
    </motion.li>
  );
}
