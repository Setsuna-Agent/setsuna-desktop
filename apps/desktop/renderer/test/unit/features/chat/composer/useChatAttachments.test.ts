import type { RuntimeMessageAttachment, RuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ChatComposerAttachmentItem } from '../../../../../src/features/chat/composer/chatAttachments.js';
import {
  createChatAttachmentStore,
  disposableChatAttachments,
  inlineImageAttachmentsToStore,
} from '../../../../../src/features/chat/composer/chatAttachmentStore.js';

it.each(['data:image/png;base64,%%%', 'data:image/png;base64,a'])(
  'contains invalid inline image conversion errors while restoring other attachments (%s)', async (url) => {
    const invalid = { id: 'invalid-image', name: 'broken.png', type: 'image/png', size: 4, url };
    const valid = { ...invalid, id: 'valid-image', name: 'valid.png', url: 'data:image/png;base64,aW1n' };
    const uploaded = storedAttachment('uploaded');
    const client = { uploadAttachment: vi.fn(async () => uploaded), deleteAttachment: vi.fn(), linkAttachment: vi.fn() };
    const store = createChatAttachmentStore(client, (key) => key);
    expect(() => store.replaceWithExisting([invalid, valid])).not.toThrow();
    await vi.waitFor(() => expect(store.getSnapshot().items.map((item) => item.status)).toEqual(['error', 'ready']));
    expect(store.getSnapshot().items[0]).toMatchObject({ attachment: invalid, error: expect.any(String) });
    expect(store.getSnapshot().items[1].attachment).toEqual(uploaded);
    expect(client.uploadAttachment).toHaveBeenCalledExactlyOnceWith({
      name: valid.name, type: valid.type, data: Uint8Array.from(Buffer.from('img')),
    });
  },
);

describe('disposableChatAttachments', () => {
  it('keeps a leased attachment alive while a send is pending', () => {
    const attachment = storedAttachment('asset-A');
    const item: ChatComposerAttachmentItem = {
      attachment,
      key: 'item-A',
      name: attachment.name,
      size: attachment.size,
      status: 'ready',
      type: attachment.type,
    };

    expect(disposableChatAttachments([item], new Set([attachment.id]))).toEqual([]);
    expect(disposableChatAttachments([item], new Set())).toEqual([attachment]);
  });

  it('scopes disposal to each composer attachment tray', () => {
    const attachmentA = storedAttachment('asset-A');
    const attachmentB = storedAttachment('asset-B');
    const itemA = readyItem(attachmentA);
    const itemB = readyItem(attachmentB);

    expect(disposableChatAttachments([itemA], new Set([attachmentA.id]))).toEqual([]);
    expect(disposableChatAttachments([itemB], new Set())).toEqual([attachmentB]);
  });

  it('identifies legacy inline images loaded into a queued-turn edit for immediate storage', () => {
    const inline: RuntimeMessageAttachment = {
      id: 'inline-image',
      name: 'queued.png',
      size: 4,
      type: 'image/png',
      source: 'inline',
      url: 'data:image/png;base64,aW1n',
    };
    const item: ChatComposerAttachmentItem = {
      attachment: inline,
      key: 'queued-image-item',
      name: inline.name,
      size: inline.size,
      status: 'ready',
      type: inline.type,
    };

    expect(inlineImageAttachmentsToStore([item])).toEqual([{ item, attachment: inline }]);
    expect(inlineImageAttachmentsToStore([readyItem(storedAttachment('stored-image'))])).toEqual([]);
  });
});

function readyItem(attachment: RuntimeStoredMessageAttachment): ChatComposerAttachmentItem {
  return {
    attachment,
    key: `item-${attachment.id}`,
    name: attachment.name,
    size: attachment.size,
    status: 'ready',
    type: attachment.type,
  };
}

function storedAttachment(id: string): RuntimeStoredMessageAttachment {
  return {
    id,
    assetId: id,
    name: `${id}.txt`,
    source: 'runtime',
    size: 12,
    type: 'text/plain',
  };
}
