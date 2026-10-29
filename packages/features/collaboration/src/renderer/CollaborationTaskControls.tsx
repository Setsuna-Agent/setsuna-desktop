import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { IconButton } from '@setsuna-desktop/renderer-ui';
import { CircleX, Pause } from 'lucide-react';
import { useRef, useState } from 'react';
import { useCollaborationActions } from './context.js';

/** Lifecycle controls only; task instructions are routed through the parent conversation. */
export function CollaborationTaskControls({ parentThreadId, childThreadId, activeTurnId, translate: t, onError }: Readonly<{
  parentThreadId: string; childThreadId: string; activeTurnId: string | null;
  translate: RendererTranslate; onError(message: string): void;
}>) {
  const service = useCollaborationActions();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  async function act(action: 'interrupt' | 'close') {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      await service.act({ threadId: parentThreadId, childThreadId, action,
        expectedTurnId: activeTurnId,
      });
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <>
    <IconButton type="button" disabled={busy || !service.available} label={t('feature.collaboration.panel.stopTracking')} onClick={() => { void act('close'); }}><CircleX size={16} /></IconButton>
    {activeTurnId ? <IconButton type="button" disabled={busy || !service.available} label={t('feature.collaboration.panel.interrupt')} onClick={() => { void act('interrupt'); }}><Pause size={16} /></IconButton> : null}
  </>;
}
