import { useState } from 'react';
import type { ChatStarterLocationSelection } from '../conversation/ChatStarterWorkspace.js';
import type { ChatTurnActions } from './useChatTurnActions.js';

/** The choice belongs to this unsent chat; choosing it never creates a workspace. */
export function useChatStarterLocation({ identity, canCreateWorktree, hasThread, onSend }: {
  identity: string;
  canCreateWorktree: boolean;
  hasThread: boolean;
  onSend: ChatTurnActions['sendInput'];
}) {
  const [choice, setChoice] = useState<{ identity: string; value: ChatStarterLocationSelection['value'] } | null>(null);
  const [pendingIdentity, setPendingIdentity] = useState<string | null>(null);
  const value = canCreateWorktree && choice?.identity === identity ? choice.value : 'local';
  const selection: ChatStarterLocationSelection = {
    value,
    canCreateWorktree,
    disabled: hasThread || pendingIdentity === identity,
    onChange: (next) => {
      if (!hasThread && pendingIdentity !== identity && (next === 'local' || canCreateWorktree)) {
        setChoice({ identity, value: next });
      }
    },
  };
  const sendInput: ChatTurnActions['sendInput'] = async (input, options) => {
    if (hasThread) return onSend(input, options);
    if (pendingIdentity === identity) return false;
    setPendingIdentity(identity);
    try {
      return await onSend(input, { ...options, workspaceMode: value });
    } finally {
      // An earlier send must not unlock the picker of a different draft being submitted.
      setPendingIdentity((current) => current === identity ? null : current);
    }
  };
  return { selection, sendInput };
}
