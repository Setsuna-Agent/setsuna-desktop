import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import type { ChatImageAttachmentOutcome, ChatImageAttachmentRequest } from '../types/app.js';

type AttachmentRequestResolver = (outcome: ChatImageAttachmentOutcome) => void;

/** Bridges image producers outside ChatComposer to its private attachment tray. */
export function useChatImageAttachmentRequest() {
  const [imageAttachmentRequest, setImageAttachmentRequest] = useState<ChatImageAttachmentRequest | null>(null);
  const requestIdRef = useRef(0);
  const pendingRequestIdRef = useRef<number | null>(null);
  const resolversRef = useRef(new Map<number, AttachmentRequestResolver>());

  const requestImageAttachment = useCallback((attachment: RuntimeMessageAttachment) => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const previousRequestId = pendingRequestIdRef.current;
    if (previousRequestId !== null) {
      resolversRef.current.get(previousRequestId)?.('unavailable');
      resolversRef.current.delete(previousRequestId);
    }
    pendingRequestIdRef.current = requestId;
    setImageAttachmentRequest({ attachment, requestId });
    return new Promise<ChatImageAttachmentOutcome>((resolve) => {
      resolversRef.current.set(requestId, resolve);
    });
  }, []);

  const resolveImageAttachmentRequest = useCallback((requestId: number, outcome: ChatImageAttachmentOutcome) => {
    resolversRef.current.get(requestId)?.(outcome);
    resolversRef.current.delete(requestId);
    if (pendingRequestIdRef.current === requestId) pendingRequestIdRef.current = null;
    setImageAttachmentRequest((current) => current?.requestId === requestId ? null : current);
  }, []);

  useEffect(() => () => {
    for (const resolve of resolversRef.current.values()) resolve('unavailable');
    resolversRef.current.clear();
    pendingRequestIdRef.current = null;
  }, []);

  return {
    imageAttachmentRequest,
    requestImageAttachment,
    resolveImageAttachmentRequest,
  };
}
