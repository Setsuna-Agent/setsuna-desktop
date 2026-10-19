// Adapted from beUI's Collapsible (MIT): https://beui.dev/components/motion/collapsible
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import type { ReactNode } from 'react';
import { EASE_OUT, SPRING_LAYOUT } from '../motion.js';

const REVEAL_TRANSITION: Transition = {
  height: SPRING_LAYOUT,
  opacity: { duration: 0.2, ease: EASE_OUT },
};

// 收起用定时补间：过阻尼弹簧在接近 0 时会拖出一段长尾巴，
// 内容看起来已经收起却还要停留一会儿才卸载，视觉上就是“顿一下”。
const COLLAPSE_TRANSITION: Transition = {
  height: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
  opacity: { duration: 0.12, ease: EASE_OUT },
};

const INSTANT_TRANSITION: Transition = { duration: 0 };

/**
 * 受控折叠内容：展开时高度从 0 弹簧过渡到 auto 并淡入，收起动画结束后再卸载。
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
          initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
          animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
          exit={{
            height: 0,
            opacity: 0,
            overflow: 'hidden',
            transition: reduceMotion ? INSTANT_TRANSITION : COLLAPSE_TRANSITION,
          }}
          transition={reduceMotion ? INSTANT_TRANSITION : REVEAL_TRANSITION}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
