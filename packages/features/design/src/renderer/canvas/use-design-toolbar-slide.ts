import { useLayoutEffect, useRef } from 'react';

export function useDesignToolbarSlide(layersOpen: boolean, enabled: boolean) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const previousLeft = useRef<number>();

  function captureToolbarPosition() {
    const toolbar = toolbarRef.current;
    if (!enabled || !toolbar || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Start from the visible position if the user reverses an in-flight slide.
    const translated = Number.parseFloat(getComputedStyle(toolbar).getPropertyValue('translate')) || 0;
    previousLeft.current = toolbar.offsetLeft + translated;
  }

  useLayoutEffect(() => {
    const from = previousLeft.current;
    previousLeft.current = undefined;
    const toolbar = toolbarRef.current;
    if (!enabled || !toolbar || from === undefined) return;
    const distance = from - toolbar.offsetLeft;
    if (Math.abs(distance) < 1) return;
    const animation = toolbar.animate?.([{ translate: `${distance}px 0px` }, { translate: '0px 0px' }], {
      duration: 230,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    });
    return () => animation?.cancel();
  }, [layersOpen, enabled]);

  return { toolbarRef, captureToolbarPosition };
}
