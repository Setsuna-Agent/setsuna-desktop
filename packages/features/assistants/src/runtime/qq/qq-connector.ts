import { assistantPeerLabel, type Assistant, type AssistantConnectorStatus, type AssistantsRuntimeHost, type AssistantsState } from '../../contracts/index.js';
import { pruneInbox, samePeer, type AssistantDeliveryOutbox } from '../deliveries.js';
import { qqSecretKey, type AssistantDirectory } from '../directory.js';
import type { AssistantsStateStore } from '../state-store.js';
import { QqApiClient } from './qq-api.js';
import { QqGatewaySession } from './qq-gateway.js';
import { parseQqDispatch, type QqInboundMessage } from './qq-messages.js';

type Connection = { appId: string; secret: string; session: QqGatewaySession };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Text the assistant receives for a QQ message; group messages name their sender. */
function inboundText(message: QqInboundMessage): string {
  if (message.peer.kind === 'group') return `[QQ 群 ${message.peer.openid.slice(-6)} · 成员 ${message.authorOpenid.slice(-6)}] ${message.content}`;
  return `[QQ 私聊 ${message.peer.openid.slice(-6)}] ${message.content}`;
}

/**
 * Keeps one gateway session per enabled assistant and routes inbound messages into assistant
 * conversations. Connections run in the background and never block runtime readiness.
 */
export class QqConnectorManager {
  private readonly connections = new Map<string, Connection>();
  private readonly status = new Map<string, AssistantConnectorStatus>();
  private syncing: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly host: AssistantsRuntimeHost,
    private readonly store: AssistantsStateStore,
    private readonly directory: AssistantDirectory,
    private readonly outbox: AssistantDeliveryOutbox,
    private readonly onError: (error: unknown) => void,
  ) {}

  statuses(): AssistantConnectorStatus[] {
    return this.store.current.assistants.map((assistant) => structuredClone(this.status.get(assistant.id)
      ?? { assistantId: assistant.id, state: 'disabled', secretConfigured: false }));
  }

  /** Reconciles live sessions with configuration; serialized so rapid edits never open two sessions. */
  sync(): Promise<void> {
    this.syncing = this.syncing.then(() => this.reconcile()).catch(this.onError);
    return this.syncing;
  }

  dispose(): void {
    this.disposed = true;
    for (const assistantId of [...this.connections.keys()]) this.close(assistantId);
  }

  private async reconcile(): Promise<void> {
    if (this.disposed) return;
    const assistants = this.store.current.assistants;
    for (const assistantId of [...this.connections.keys()]) {
      if (!assistants.some((assistant) => assistant.id === assistantId)) this.close(assistantId);
    }
    for (const id of [...this.status.keys()]) if (!assistants.some((assistant) => assistant.id === id)) this.status.delete(id);
    for (const assistant of assistants) {
      const secret = await this.host.secrets.get(qqSecretKey(assistant.id)).catch(() => undefined);
      if (this.disposed) return;
      const wanted = assistant.qq?.enabled && secret ? { appId: assistant.qq.appId, secret } : null;
      const current = this.connections.get(assistant.id);
      if (current && wanted && current.appId === wanted.appId && current.secret === wanted.secret) continue;
      if (current) this.close(assistant.id);
      this.setStatus(assistant.id, { state: 'disabled', secretConfigured: Boolean(secret) });
      if (wanted) this.open(assistant.id, wanted.appId, wanted.secret);
    }
  }

  private open(assistantId: string, appId: string, secret: string): void {
    const api = new QqApiClient({ appId, secret, fetch: (input, init) => this.host.fetch(input, init), now: () => this.host.now() });
    const session = new QqGatewaySession({
      api,
      openWebSocket: (url) => this.host.openWebSocket(url),
      onStatus: (status) => {
        if (this.connections.get(assistantId)?.session === session) this.setStatus(assistantId, status);
      },
      onDispatch: (type, data) => {
        const message = parseQqDispatch(type, data, this.host.now());
        if (message) void this.receive(assistantId, message).catch(this.onError);
      },
    });
    this.connections.set(assistantId, { appId, secret, session });
    // Replies use the HTTP API, so owed replies can go out even while the gateway reconnects.
    this.outbox.setSender(assistantId, {
      // Read formatting at send time so changing it never reconnects the gateway.
      send: (peer, message) => api.sendMessage(peer, {
        ...message, markdownEnabled: this.directory.assistant(assistantId)?.qq?.markdownEnabled !== false,
      }),
    });
    session.start();
  }

  private close(assistantId: string): void {
    this.connections.get(assistantId)?.session.stop();
    this.connections.delete(assistantId);
    this.outbox.setSender(assistantId, null);
  }

  private setStatus(assistantId: string, status: { state: AssistantConnectorStatus['state']; error?: string; secretConfigured?: boolean }): void {
    const previous = this.status.get(assistantId);
    this.status.set(assistantId, {
      assistantId, state: status.state, secretConfigured: status.secretConfigured ?? previous?.secretConfigured ?? true,
      ...(status.error ? { error: status.error } : {}),
    });
  }

  /** Records the message, enforces the peer allowlist and starts an assistant turn with a reply route. */
  private async receive(assistantId: string, message: QqInboundMessage): Promise<void> {
    await this.store.mutate(async (transaction) => {
      const { state } = transaction;
      const assistant = state.assistants.find((item) => item.id === assistantId);
      // QQ may redeliver a message after reconnecting; each msg_id is handled once.
      if (!assistant?.qq?.enabled || state.inbox.some((entry) => entry.assistantId === assistantId && entry.messageId === message.messageId)) return;
      state.inbox.push({ assistantId, messageId: message.messageId, peer: message.peer, receivedAt: message.receivedAt, repliesUsed: 0 });
      pruneInbox(state);
      const peer = this.trackPeer(state, assistant, message);
      if (peer.status !== 'allowed') {
        // Reply to each new message; the inbox check above still deduplicates gateway redelivery.
        const label = assistantPeerLabel(peer, peer.kind === 'c2c' ? '私聊' : '群聊');
        this.outbox.expectReply(state, {
          assistantId, peer: message.peer, replyToMessageId: message.messageId,
          content: `你好，我是${assistant.name}。「${label}」还没有获得授权，请联系我的主人在 Setsuna 中允许后再试。`,
        });
        return;
      }
      const threadId = await this.directory.ensureConversation(state, assistant);
      const delivery = this.outbox.expectReply(state, {
        assistantId, peer: message.peer, threadId, clientId: this.host.id('assistant_qq'), replyToMessageId: message.messageId,
        ...(message.peer.kind === 'group' ? { initiator: message.authorOpenid } : {}),
      });
      // The reply route must be durable before the turn can finish.
      await transaction.commit();
      try {
        const started = await this.host.startTurn(threadId, {
          input: inboundText(message), clientId: delivery.clientId,
          ...(assistant.modelSelection ? { modelSelection: assistant.modelSelection } : {}),
          ...(assistant.thinkingEffort ? { thinkingEffort: assistant.thinkingEffort } : {}),
        });
        if (started.turnId) delivery.turnId = started.turnId;
      } catch (error) {
        Object.assign(delivery, { status: 'ready', content: `抱歉，暂时无法处理这条消息：${errorMessage(error)}` });
      }
    });
    await this.outbox.recover();
  }

  /** Refreshes source identity data without changing the owner's authorization decision. */
  private trackPeer(state: AssistantsState, assistant: Assistant, message: QqInboundMessage) {
    const now = this.host.now().toISOString();
    const name = message.displayName ? { displayName: message.displayName } : {};
    const existing = state.peers.find((item) => item.assistantId === assistant.id && samePeer(item, message.peer));
    if (existing) return Object.assign(existing, { lastSeenAt: now, ...name });
    const peer = { ...message.peer, ...name, assistantId: assistant.id, status: 'pending' as const, firstSeenAt: now, lastSeenAt: now };
    state.peers.push(peer);
    return peer;
  }
}
