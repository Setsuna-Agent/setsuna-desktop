import { useCallback, useEffect, useRef, useState } from 'react';
import { captureTextContextMenuTarget, type TextContextMenuTarget } from '../../shared/lib/textContextMenu.js';
import { TextEditingPointMenu } from '../../shared/ui/TextEditingPointMenu.js';

type TextMenuRequest = { id: number; x: number; y: number; target: TextContextMenuTarget };

export function AppTextContextMenu() {
  const [request, setRequest] = useState<TextMenuRequest | null>(null);
  const current = useRef<TextMenuRequest | null>(null);
  const sequence = useRef(0);
  const close = useCallback(() => setRequest(null), []);
  useEffect(() => {
    const open = (event: MouseEvent) => {
      // Specialized link, file, image and terminal menus handle the event first.
      if (event.defaultPrevented || !window.setsunaDesktop?.windowControls.executeTextEdit) return;
      const target = captureTextContextMenuTarget(event);
      if (!target) return;
      event.preventDefault();
      const next = { id: ++sequence.current, x: event.clientX, y: event.clientY, target };
      current.current = next;
      setRequest(next);
    };
    window.addEventListener('contextmenu', open);
    return () => { window.removeEventListener('contextmenu', open); current.current = null; };
  }, []);

  return request ? <TextEditingPointMenu key={request.id} x={request.x} y={request.y} textTarget={request.target} onClose={close}
    isCurrent={() => current.current === request} /> : null;
}
