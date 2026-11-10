import type { AssistantQqPeer } from './types.js';

/** Keep the authorization notice and the editor's source label consistent. */
export function assistantPeerLabel(peer: Pick<AssistantQqPeer, 'openid' | 'displayName'>, kindLabel: string): string {
  return peer.displayName ?? `${kindLabel} · ${peer.openid.slice(-6)}`;
}
