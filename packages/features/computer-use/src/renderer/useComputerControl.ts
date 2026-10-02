import { useEffect, useRef, useState } from 'react';
import type { ComputerBridge, ComputerPreviewFrame } from '../contracts/index.js';

export function useComputerControl(bridge: ComputerBridge, previewOpen: boolean) {
  const [active, setActive] = useState(false);
  const [frame, setFrame] = useState<ComputerPreviewFrame | null>(null);
  const [stopping, setStopping] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const mounted = useRef(false);
  const stopPending = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, [bridge]);

  useEffect(() => {
    if (!previewOpen) setFrame(null);
    if (stopping) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
      const current = revision.current;
      const isCurrent = () => !disposed && current === revision.current;
      try {
        // Images cross IPC only while the preview is visible, without starting another capture.
        const value = previewOpen ? await bridge.preview() : { ...await bridge.status(), frame: null };
        if (!isCurrent()) return;
        setActive(value.active);
        setFrame(value.active ? value.frame : null);
        setReadError(null);
      } catch (cause) {
        if (isCurrent()) setReadError(String(cause));
      } finally {
        if (!disposed) timer = setTimeout(() => { void update(); }, 1000);
      }
    };
    void update();
    return () => { disposed = true; clearTimeout(timer); };
  }, [bridge, previewOpen, stopping]);

  const stop = async () => {
    if (stopPending.current) return;
    stopPending.current = true;
    ++revision.current; // An in-flight preview must not revive a session after the user stops it.
    setStopping(true);
    setStopError(null);
    try {
      await bridge.stop();
      if (mounted.current) { setActive(false); setFrame(null); }
    } catch (cause) {
      if (mounted.current) setStopError(String(cause));
    } finally {
      stopPending.current = false;
      if (mounted.current) setStopping(false);
    }
  };

  return { active, frame, stopping, error: stopError ?? readError, stop };
}
