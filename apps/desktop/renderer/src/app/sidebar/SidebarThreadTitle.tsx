import { useEffect, useRef, useState, type CSSProperties } from 'react';

const LOOP_GAP_PX = 100;
const SPEED_PX_PER_SECOND = 40;

export function SidebarThreadTitle({ hovered, title }: { hovered: boolean; title: string }) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!hovered || !viewport || !text) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const measure = () => {
      // Layout widths keep the speed and gap consistent when the app uses CSS zoom.
      const textWidth = text.offsetWidth;
      setDistance(!reducedMotion.matches && viewport.clientWidth > 0 && textWidth > viewport.clientWidth
        ? textWidth + LOOP_GAP_PX
        : 0);
    };
    measure();
    // Only the hovered row observes resizing, including the archive button's reserved space.
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    reducedMotion.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener('change', measure);
    };
  }, [hovered, title]);

  const scrolling = hovered && distance > 0;
  const style = scrolling ? {
    '--sidebar-title-loop-gap': `${LOOP_GAP_PX}px`,
    '--sidebar-title-loop-duration': `${distance / SPEED_PX_PER_SECOND}s`,
  } as CSSProperties : undefined;

  return (
    <span className="desktop-agent-session__title" ref={viewportRef}>
      <span
        className={`desktop-agent-session__title-track${scrolling ? ' is-scrolling' : ''}`}
        style={style}
      >
        <span ref={textRef}>{title}</span>
        {scrolling ? <span aria-hidden="true">{title}</span> : null}
      </span>
    </span>
  );
}
