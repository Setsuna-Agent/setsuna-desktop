import { useToast } from '@setsuna-desktop/renderer-ui';
import { useEffect, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DiagnosticLogsBridge } from '../contracts/index.js';

export function useDiagnosticLogs(bridge: DiagnosticLogsBridge, t: RendererTranslate) {
  const toast = useToast();
  const [directory, setDirectory] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => bridge.getLogDirectory()).then((value) => {
      if (active) setDirectory(value);
    }).catch((error: unknown) => {
      if (active) toast.error(error instanceof Error ? error.message : t('feature.diagnostics.loadFailed'));
    });
    return () => { active = false; };
  }, [bridge, t, toast]);

  const openDirectory = async () => {
    if (running.current) return;
    running.current = true;
    setOpening(true);
    try {
      const result = await bridge.openLogDirectory();
      if (!result.ok) toast.error(result.error);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('feature.diagnostics.openFailed'));
    } finally {
      running.current = false;
      setOpening(false);
    }
  };

  return { directory, opening, openDirectory };
}
