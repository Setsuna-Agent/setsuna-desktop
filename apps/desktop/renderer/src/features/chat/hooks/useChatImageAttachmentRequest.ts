import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatImageAttachmentOutcome, ChatImageAttachmentRequest } from '../../../app/types.js';

type AttachmentRequestResolver = (outcome: ChatImageAttachmentOutcome) => void;

/** 将 ChatComposer 外部的图像来源桥接到其私有附件托盘。 */
export function useChatImageAttachmentRequest(composerKey: string) {
  const [scopedRequest, setScopedRequest] = useState<{
    composerKey: string;
    request: ChatImageAttachmentRequest;
  } | null>(null);
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
    setScopedRequest({ composerKey, request: { attachment, requestId } });
    return new Promise<ChatImageAttachmentOutcome>((resolve) => {
      resolversRef.current.set(requestId, resolve);
    });
  }, [composerKey]);

  const resolveImageAttachmentRequest = useCallback((requestId: number, outcome: ChatImageAttachmentOutcome) => {
    resolversRef.current.get(requestId)?.(outcome);
    resolversRef.current.delete(requestId);
    if (pendingRequestIdRef.current === requestId) pendingRequestIdRef.current = null;
    setScopedRequest((current) => current?.request.requestId === requestId ? null : current);
  }, []);

  const imageAttachmentRequest = scopedRequest?.composerKey === composerKey
    ? scopedRequest.request
    : null;

  useEffect(() => {
    if (!scopedRequest || scopedRequest.composerKey === composerKey) return;
    resolveImageAttachmentRequest(scopedRequest.request.requestId, 'unavailable');
  }, [composerKey, resolveImageAttachmentRequest, scopedRequest]);

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
