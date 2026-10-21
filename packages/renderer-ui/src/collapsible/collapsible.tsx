// Adapted from beUI's Collapsible (MIT): https://beui.dev/components/motion/collapsible
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import type { ReactNode } from 'react';
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

/**
 * 用网格轨道展开自然高度，避免 Motion 将缩放后的 DOMRect 当成 CSS 高度，
 * 在动画结束切回 auto 时突然增减空白。收起动画结束后再卸载。
 * 只在动画期间裁切溢出，静止展开时不裁掉子元素的焦点环和阴影。
 */
export function CollapsibleContent({ open, children, className, id, onExitComplete }: {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
  /** 收起动画结束、内容已卸载后触发。 */
  onExitComplete?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence initial={false} onExitComplete={onExitComplete}>
      {open ? (
        <motion.div
          key="collapsible-content"
          className={className}
          id={id}
          style={{ display: 'grid' }}
          initial={{ gridTemplateRows: '0fr', opacity: 0, overflow: 'hidden' }}
          animate={{ gridTemplateRows: '1fr', opacity: 1, transitionEnd: { overflow: 'visible' } }}
          exit={{
            gridTemplateRows: '0fr',
            opacity: 0,
            overflow: 'hidden',
            transition: reduceMotion ? INSTANT_TRANSITION : COLLAPSE_TRANSITION,
          }}
          transition={reduceMotion ? INSTANT_TRANSITION : REVEAL_TRANSITION}
        >
          {/* 将内容的 padding/margin 留在可压缩轨道内，0fr 才能完全收拢。 */}
          <div style={{ minHeight: 0, minWidth: 0 }}>{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
