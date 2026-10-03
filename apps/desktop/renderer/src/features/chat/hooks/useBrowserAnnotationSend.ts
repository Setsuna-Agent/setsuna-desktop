import type { DesktopRuntimeClient } from '@setsuna-desktop/contracts';
import type { BrowserAnnotationSendHandler } from '@setsuna-desktop/feature-browser/contracts';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { uploadInlineChatImageAttachment } from '../composer/chatImageAttachments.js';
import type { ChatTurnActions } from './useChatTurnActions.js';

export function useBrowserAnnotationSend({ identity, client, sendInput }: {
  identity: string;
  client: Pick<DesktopRuntimeClient, 'uploadAttachment' | 'deleteAttachment'>;
  sendInput: ChatTurnActions['sendInput'];
}): BrowserAnnotationSendHandler {
  const owner = useMemo(() => ({ identity, discardUploads: new Set<() => void>() }), [identity]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const mounted = useRef(true);
  const latestSendInput = useRef(sendInput);
  latestSendInput.current = sendInput;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => () => {
    for (const discard of owner.discardUploads) discard();
    owner.discardUploads.clear();
  }, [owner]);

  return useCallback(async (input, screenshots) => {
    // Panels upload independent batches; only a change of chat ownership invalidates them.
    const isCurrentOwner = () => mounted.current && currentOwner.current === owner;
    // Screenshot capture can retain an old callback before the upload even starts.
    if (!isCurrentOwner()) return false;
    const uploadedIds = new Set<string>();
    let discarded = false;
    let sent = false;
    const discard = () => {
      discarded = true;
      for (const assetId of uploadedIds) void client.deleteAttachment(assetId).catch(() => undefined);
      uploadedIds.clear();
    };
    owner.discardUploads.add(discard);
    try {
      const attachments = await Promise.all(screenshots.map(async (screenshot) => {
        const attachment = await uploadInlineChatImageAttachment(screenshot, client);
        uploadedIds.add(attachment.assetId);
        // Promise.all can fail before another upload completes; dispose those late assets too.
        if (discarded || !isCurrentOwner()) discard();
        return attachment;
      }));
      if (!isCurrentOwner()) return false;
      // Once handed to the shared submission queue, its result decides ownership. Navigation
      // may cancel a waiting job, but must not delete images while a dispatched send is settling.
      owner.discardUploads.delete(discard);
      sent = await latestSendInput.current(input, { attachments, preserveDraft: true });
      return sent;
    } finally {
      owner.discardUploads.delete(discard);
      if (!sent) discard();
    }
  }, [client, owner]);
}
