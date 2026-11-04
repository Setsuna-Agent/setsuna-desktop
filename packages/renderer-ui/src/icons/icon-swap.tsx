import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import type { ReactNode } from 'react';
import { EASE_OUT, SPRING_PRESS } from '../motion.js';

const ENTER_TRANSITION: Transition = {
  opacity: { duration: 0.12, ease: EASE_OUT },
  scale: SPRING_PRESS,
};

const EXIT_TRANSITION: Transition = { duration: 0.1, ease: EASE_OUT };

const INSTANT_TRANSITION: Transition = { duration: 0 };

/**
 * 同一按钮内的图标状态切换（复制成功、发送 / 停止等）：新旧图标叠放在同一网格单元，
 * 交叉淡入并轻微缩放。只动图标，按钮本身不缩放、不位移；首次挂载不播放。
 * 调用方需保持按钮节点稳定，swapKey 变化时才会过渡。
 */
export function IconSwap({ swapKey, children }: {
  swapKey: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <span style={{ display: 'inline-grid', placeItems: 'center' }}>
      <AnimatePresence initial={false}>
        <motion.span
          key={swapKey}
          style={{ display: 'inline-flex', gridArea: '1 / 1' }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{
            opacity: 0,
            scale: 0.6,
            transition: reduceMotion ? INSTANT_TRANSITION : EXIT_TRANSITION,
          }}
          transition={reduceMotion ? INSTANT_TRANSITION : ENTER_TRANSITION}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
