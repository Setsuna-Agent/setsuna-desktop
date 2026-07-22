import type { RuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import type { ChatComposerAttachmentItem } from '../../../../../src/features/chat/composer/chatAttachments.js';
import { disposableChatAttachments } from '../../../../../src/features/chat/composer/useChatAttachments.js';

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
