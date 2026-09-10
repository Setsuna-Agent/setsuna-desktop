import type { GetRef, Input } from 'antd';
import { useRef, useState, type ButtonHTMLAttributes } from 'react';

const MIN_HEIGHT = 26;
const ROW_HEIGHT = 18;

/** Manual sizing takes precedence over auto-growth until the user resets the grip. */
export function useCommitMessageInputResize() {
  const inputRef = useRef<GetRef<typeof Input.TextArea>>(null);
  const [height, setHeight] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; y: number; height: number; scale: number } | null>(null);
  const textarea = () => inputRef.current?.resizableTextArea?.textArea;
  const clamp = (value: number) => Math.round(Math.max(MIN_HEIGHT, Math.min(window.innerHeight / 2, value)));
  const stopResize = () => { drag.current = null; };
  const resizeHandleProps: ButtonHTMLAttributes<HTMLButtonElement> = {
    onPointerDown(event) {
      const element = textarea();
      if (event.button !== 0 || !element) return;
      const bounds = element.getBoundingClientRect();
      if (!bounds.height) return;
      event.preventDefault();
      drag.current = {
        pointerId: event.pointerId, y: event.clientY, height: element.offsetHeight,
        // Pointer coordinates include UI zoom; textarea heights use CSS pixels.
        scale: element.offsetHeight / bounds.height,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event) {
      const start = drag.current;
      if (start?.pointerId !== event.pointerId) return;
      setHeight(clamp(start.height + (event.clientY - start.y) * start.scale));
    },
    onPointerUp(event) {
      if (drag.current?.pointerId !== event.pointerId) return;
      stopResize();
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: stopResize,
    onLostPointerCapture: stopResize,
    onDoubleClick: () => setHeight(null),
    onKeyDown(event) {
      const current = textarea()?.offsetHeight ?? MIN_HEIGHT;
      if (event.key === 'Home') {
        event.preventDefault();
        setHeight(null);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        setHeight(clamp(current + (event.key === 'ArrowUp' ? -ROW_HEIGHT : ROW_HEIGHT)));
      }
    },
  };
  return { inputRef, height, resizeHandleProps };
}
