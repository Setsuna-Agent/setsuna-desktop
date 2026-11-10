import type { AssistantInboxEntry, AssistantPeerKind, AssistantPeerRef } from '../../contracts/index.js';

export type QqInboundMessage = {
  messageId: string;
  peer: AssistantPeerRef;
  /** A private user's nickname when supplied. A group sender's name is not the group's name. */
  displayName?: string;
  /** user_openid for private chats, member_openid inside groups. */
  authorOpenid: string;
  content: string;
  receivedAt: string;
};

/** QQ rejects very long text messages; split replies at readable boundaries below this size. */
export const QQ_REPLY_CHUNK_LIMIT = 1_500;

/**
 * Passive replies reuse the inbound msg_id. Private chats allow 4 replies within 60 minutes and
 * groups 5 replies within 5 minutes; later replies are sent as active messages.
 */
const PASSIVE_WINDOWS: Record<AssistantPeerKind, { durationMs: number; replies: number }> = {
  c2c: { durationMs: 60 * 60_000, replies: 4 },
  group: { durationMs: 5 * 60_000, replies: 5 },
};

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function attachmentNotes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const attachment = objectField(item);
    const type = stringField(attachment.content_type) ?? '';
    return type.startsWith('image/') ? '[图片]' : `[附件 ${stringField(attachment.filename) ?? ''}]`.replace(' ]', ']');
  });
}

/** Normalizes private messages and both group event formats without answering unaddressed group chatter. */
export function parseQqDispatch(type: string, data: unknown, now: Date): QqInboundMessage | null {
  if (type !== 'C2C_MESSAGE_CREATE' && type !== 'GROUP_AT_MESSAGE_CREATE' && type !== 'GROUP_MESSAGE_CREATE') return null;
  const payload = objectField(data);
  // The newer event also carries ordinary group messages; only the platform's self-mention flag permits a reply.
  if (type === 'GROUP_MESSAGE_CREATE' && (!Array.isArray(payload.mentions)
    || !payload.mentions.some((mention) => objectField(mention).is_you === true))) return null;
  const author = objectField(payload.author);
  const messageId = stringField(payload.id);
  const authorOpenid = stringField(type === 'C2C_MESSAGE_CREATE' ? author.user_openid : author.member_openid);
  const peerOpenid = type === 'C2C_MESSAGE_CREATE' ? authorOpenid : stringField(payload.group_openid);
  const content = [stringField(payload.content) ?? '', ...attachmentNotes(payload.attachments)].filter(Boolean).join(' ');
  if (!messageId || !authorOpenid || !peerOpenid || !content) return null;
  if (![authorOpenid, peerOpenid].every((id) => /^[A-Za-z0-9_-]{1,128}$/u.test(id))) return null;
  const timestamp = stringField(payload.timestamp);
  const displayName = type === 'C2C_MESSAGE_CREATE' ? stringField(author.username)?.replace(/\s+/gu, ' ').slice(0, 120) : undefined;
  return {
    messageId, authorOpenid, content: content.slice(0, 16_000),
    ...(displayName ? { displayName } : {}),
    peer: { kind: type === 'C2C_MESSAGE_CREATE' ? 'c2c' : 'group', openid: peerOpenid },
    receivedAt: timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : now.toISOString(),
  };
}

/** Splits at paragraph, line, then sentence boundaries so each QQ message stays readable. */
export function splitReply(content: string, limit = QQ_REPLY_CHUNK_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = content.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const boundary = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.search(/[。！？.!?][^。！？.!?]*$/u)]
      .find((index) => index > limit / 2);
    let cut = boundary === undefined ? limit : boundary + 1;
    // QQ text commonly contains emoji. Never split a UTF-16 surrogate pair between requests.
    const preceding = rest.charCodeAt(cut - 1);
    if (preceding >= 0xd800 && preceding <= 0xdbff) cut -= 1;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Returns the passive reply slot for the next message, or undefined when an active message is required. */
export function passiveReply(entry: AssistantInboxEntry | undefined, now: Date): { messageId: string; seq: number } | undefined {
  if (!entry) return undefined;
  const window = PASSIVE_WINDOWS[entry.peer.kind];
  const open = now.getTime() - Date.parse(entry.receivedAt) < window.durationMs && entry.repliesUsed < window.replies;
  return open ? { messageId: entry.messageId, seq: entry.repliesUsed + 1 } : undefined;
}
