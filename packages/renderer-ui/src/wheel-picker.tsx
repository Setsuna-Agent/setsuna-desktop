// Adapted from beUI Wheel Picker (MIT): https://beui.dev/components/motion/wheel-picker
// 保留 iOS 风格的动量滚动、吸附和键盘操作；去掉 beUI 的 tick 音效与外部 touch 工具模块，
// 指针捕获在这里内联实现，视觉与配色跟随宿主 token。

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from './utils.js';

export type WheelPickerOption = string | { label: string; value: string };

export type WheelPickerProps = {
  options: WheelPickerOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Rows visible through the window, odd. More = flatter curve. Default 5. */
  visibleCount?: number;
  /** Row height in px. Default 36. */
  itemHeight?: number;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
};

// 物理常量按 iOS 手感调过，不使用共享 spring：滚轮整行跳动并带一次轻微回弹，
// 这是 layout spring 表达不了的。
const DECELERATION = 0.0012; // 每毫秒平方衰减的行数；越大越快停下、滑行越短
const MAX_VELOCITY = 0.09; // 每毫秒行数上界
// 滚轮位移按 deltaY * WHEEL_SENS * itemHeight 换算。取默认行高 36px 时，
// 一次滚轮 tick（约 100px）≈ 1 行，避免轻微滚动就跨越十几行。
const WHEEL_SENS = 1 / (100 * 36);
// 拖拽阻尼：手指位移乘该系数后才换算成行进距离。取 0.4 时拖动约 90px 才换
// 一行，避免行高偏小时“轻轻一动就跳好几行”。
const DRAG_RATIO = 0.4;
const WHEEL_SETTLE = 110; // 毫秒，滚轮静默后吸附
const BACK = 1.35;

function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

function easeOutBack(progress: number): number {
  return 1 + (BACK + 1) * (progress - 1) ** 3 + BACK * (progress - 1) ** 2;
}

function optionValue(option: WheelPickerOption): string {
  return typeof option === 'string' ? option : option.value;
}

function optionLabel(option: WheelPickerOption): string {
  return typeof option === 'string' ? option : option.label;
}

export function WheelPicker({
  options,
  value,
  defaultValue,
  onValueChange,
  visibleCount = 5,
  itemHeight = 36,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: WheelPickerProps) {
  const values = useMemo(() => options.map(optionValue), [options]);
  const labels = useMemo(() => options.map(optionLabel), [options]);
  const rows = visibleCount % 2 === 0 ? visibleCount + 1 : visibleCount;
  const padding = ((rows - 1) / 2) * itemHeight;

  const uncontrolled = value === undefined;
  const [internalValue, setInternalValue] = useState(() => defaultValue ?? values[0] ?? '');
  const selectedValue = uncontrolled ? internalValue : value;
  const selectedIndex = Math.max(0, values.indexOf(selectedValue ?? ''));

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 滚动位置在动画帧之间直接读写，避免每帧触发 React 渲染。
  const offsetRef = useRef(0);
  const frameRef = useRef(0);
  const velocityRef = useRef({ lastY: 0, lastTime: 0, value: 0 });
  const wheelTimerRef = useRef(0);
  const dragRef = useRef({ active: false, startY: 0, startOffset: 0 });
  const reduceMotion = usePrefersReducedMotion();
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  const maxOffset = Math.max(0, (values.length - 1) * itemHeight);

  const applyOffset = useCallback((offset: number) => {
    const next = clamp(offset, 0, maxOffset);
    offsetRef.current = next;
    const node = scrollRef.current;
    if (node) node.style.transform = `translate3d(0, ${padding - next}px, 0)`;
    setActiveIndex(itemHeight > 0 ? Math.round(next / itemHeight) : 0);
    return next;
  }, [itemHeight, maxOffset, padding]);

  const commitIndex = useCallback((index: number) => {
    const next = values[clamp(index, 0, Math.max(0, values.length - 1))];
    if (next === undefined || next === selectedValue) return;
    if (uncontrolled) setInternalValue(next);
    onValueChange?.(next);
  }, [onValueChange, selectedValue, uncontrolled, values]);

  const stopAnimation = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }, []);

  /** 吸附到最近一行；非减速动画用 easeOutBack 制造一次轻微过冲回弹。 */
  const snapTo = useCallback((targetIndex: number, withBounce: boolean) => {
    stopAnimation();
    const from = offsetRef.current;
    const to = clamp(targetIndex * itemHeight, 0, maxOffset);
    const distance = to - from;
    if (reduceMotion || Math.abs(distance) < 0.5) {
      applyOffset(to);
      commitIndex(targetIndex);
      return;
    }
    const duration = clamp(180 + Math.abs(distance) * 1.4, 180, 520);
    let startedAt = 0;
    const step = (timestamp: number) => {
      if (!startedAt) startedAt = timestamp;
      const progress = clamp((timestamp - startedAt) / duration, 0, 1);
      applyOffset(from + distance * (withBounce ? easeOutBack(progress) : easeOutCubic(progress)));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        frameRef.current = 0;
        applyOffset(to);
        commitIndex(targetIndex);
      }
    };
    frameRef.current = requestAnimationFrame(step);
  }, [applyOffset, commitIndex, itemHeight, maxOffset, reduceMotion, stopAnimation]);

  /** 释放后按速度滑行，再交给吸附动画。 */
  const fling = useCallback((velocity: number) => {
    stopAnimation();
    const direction = Math.sign(velocity);
    // v² / (2a) 得到滑行行数，再换算成像素。
    const travelled = (velocity * velocity) / (2 * DECELERATION) * itemHeight;
    const target = clamp(
      offsetRef.current + direction * travelled,
      0,
      maxOffset,
    );
    const targetIndex = Math.round(target / itemHeight);
    snapTo(targetIndex, false);
  }, [itemHeight, maxOffset, snapTo, stopAnimation]);

  // 外部值变化、选项变化时校正位置。
  useEffect(() => {
    if (dragRef.current.active || frameRef.current) return;
    const current = Math.round(offsetRef.current / itemHeight);
    if (current === selectedIndex) return;
    applyOffset(selectedIndex * itemHeight);
  }, [applyOffset, itemHeight, selectedIndex, values.length]);

  useEffect(() => () => {
    stopAnimation();
    if (wheelTimerRef.current) window.clearTimeout(wheelTimerRef.current);
  }, [stopAnimation]);

  const nearestIndex = () => clamp(Math.round(offsetRef.current / itemHeight), 0, Math.max(0, values.length - 1));

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      snapTo(clamp(nearestIndex() - 1, 0, values.length - 1), true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      snapTo(clamp(nearestIndex() + 1, 0, values.length - 1), true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      snapTo(0, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      snapTo(values.length - 1, true);
    }
  };

  /** 滚轮：累计增量后静默数百毫秒再吸附，避免逐帧抖动。 */
  const handleWheel = (event: { deltaY: number; preventDefault: () => void }) => {
    if (disabled) return;
    event.preventDefault();
    stopAnimation();
    applyOffset(offsetRef.current + event.deltaY * WHEEL_SENS * itemHeight);
    if (wheelTimerRef.current) window.clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = window.setTimeout(() => {
      wheelTimerRef.current = 0;
      snapTo(nearestIndex(), true);
    }, WHEEL_SETTLE);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    dragRef.current = { active: true, startY: event.clientY, startOffset: offsetRef.current };
    velocityRef.current = { lastY: event.clientY, lastTime: event.timeStamp, value: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    // 阻尼后的位移既用于跟手，也用于速度估算，保证滑行与手感一致。
    applyOffset(dragRef.current.startOffset + (dragRef.current.startY - event.clientY) * DRAG_RATIO);
    const sample = velocityRef.current;
    const elapsed = event.timeStamp - sample.lastTime;
    if (elapsed > 0) {
      sample.value = ((sample.lastY - event.clientY) * DRAG_RATIO) / elapsed;
      sample.lastY = event.clientY;
      sample.lastTime = event.timeStamp;
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const velocity = clamp(velocityRef.current.value, -MAX_VELOCITY, MAX_VELOCITY);
    if (Math.abs(velocity) > 0.004) {
      fling(velocity);
    } else {
      snapTo(nearestIndex(), true);
    }
  };

  return (
    <div
      aria-label={ariaLabel}
      aria-valuemax={values.length ? values.length - 1 : 0}
      aria-valuemin={0}
      aria-valuenow={selectedIndex}
      aria-valuetext={labels[selectedIndex]}
      className={cn('sd-wheel-picker', disabled && 'is-disabled', className)}
      role={ariaLabel ? 'listbox' : undefined}
      style={{ '--sd-wheel-picker-item-height': `${itemHeight}px`, '--sd-wheel-picker-rows': rows } as React.CSSProperties}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      <div className="sd-wheel-picker__drum" ref={scrollRef} style={{ transform: `translate3d(0, ${padding - selectedIndex * itemHeight}px, 0)` }}>
        {labels.map((label, index) => {
          // 距中心越远越倾斜、越淡，形成转轮鼓面。
          const distance = index - activeIndex;
          return (
            <div
              aria-selected={index === selectedIndex}
              className={cn('sd-wheel-picker__item', distance === 0 && 'is-active')}
              data-wheel-index={index}
              key={`${values[index]}:${index}`}
              role="option"
              style={{
                transform: `rotateX(${clamp(distance, -rows, rows) * -18}deg)`,
                opacity: clamp(1 - Math.abs(distance) * 0.28, 0.12, 1),
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="sd-wheel-picker__highlight" />
      <div aria-hidden="true" className="sd-wheel-picker__fade" />
    </div>
  );
}

/** 跟随系统的“减少动态效果”，与仓库其他动效组件一致。 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
