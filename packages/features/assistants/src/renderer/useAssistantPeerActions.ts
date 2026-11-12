import { useEffect, useRef, useState } from 'react';
import type { AssistantPeerUpdate, AssistantQqPeer } from '../contracts/index.js';
import type { AssistantsRendererService } from './client.js';
import { errorMessage } from './errors.js';

/** The chat card and settings share the same guarded authorization action. */
export function useAssistantPeerActions({ service, onError }: {
  service: AssistantsRendererService;
  onError(message: string | null): void;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const update = async (peer: AssistantQqPeer, status: AssistantPeerUpdate['status']) => {
    if (pending.current || !mounted.current) return;
    pending.current = true;
    setBusy(true); onError(null);
    try {
      const snapshot = await service.client.updatePeer(peer.assistantId, { kind: peer.kind, openid: peer.openid, status });
      // The committed permission is shared even when its originating chat has closed.
      service.store.publish(snapshot);
    } catch (cause) {
      if (mounted.current) onError(errorMessage(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return { busy, updatePeer(peer: AssistantQqPeer, status: AssistantPeerUpdate['status']) { void update(peer, status); } };
}
