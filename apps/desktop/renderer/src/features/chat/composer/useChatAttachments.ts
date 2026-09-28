import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { maxChatAttachments } from './chatAttachments.js';
import {
  createChatAttachmentStore,
  type ChatAttachmentClient,
  type ChatAttachmentStore,
} from './chatAttachmentStore.js';

export function useChatAttachments({ client, store: retainedStore }: {
  client: ChatAttachmentClient;
  store?: ChatAttachmentStore;
}) {
  const { t } = useI18n();
  const [localStore] = useState(() => retainedStore ?? createChatAttachmentStore(client, t));
  const store = retainedStore ?? localStore;
  const { items, sending } = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // Retained stores belong to the conversation session, not the editor's mount.
  useEffect(() => retainedStore ? undefined : () => store.dispose(), [retainedStore, store]);

  return {
    ...store,
    atLimit: items.filter((item) => item.status !== 'removing').length >= maxChatAttachments,
    busy: sending || items.some((item) => item.status === 'preparing'),
    items,
    sending,
    sendableAttachments: items
      .filter((item) => item.status === 'ready' && item.attachment)
      .map((item) => item.attachment as RuntimeMessageAttachment),
  };
}
