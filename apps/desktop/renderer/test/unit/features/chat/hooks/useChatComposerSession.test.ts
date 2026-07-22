import { describe, expect, it } from 'vitest';
import {
  chatComposerTargetIdentity,
  transitionChatComposerSession,
  type ChatComposerSessionState,
} from '../../../../../src/features/chat/hooks/useChatComposerSession.js';

describe('chat composer session identity', () => {
  it('clears draft and rotates session when navigating from thread A to B', () => {
    const current = session('thread:A', 'draft from A', 4);
    const transition = transitionChatComposerSession(current, chatComposerTargetIdentity('B', null), null, 5);

    expect(transition).toEqual({
      claimed: false,
      state: session('thread:B', '', 5),
    });
  });

  it('claims a created thread without remounting the new-thread composer', () => {
    const current = session('new-thread-slot:project-1', 'first message', 7);
    const transition = transitionChatComposerSession(current, chatComposerTargetIdentity('created-1', null), {
      fromIdentity: 'new-thread-slot:project-1',
      sessionId: 7,
      toIdentity: 'thread:created-1',
    }, 8);

    expect(transition).toEqual({
      claimed: true,
      state: session('thread:created-1', 'first message', 7),
    });
  });

  it('rejects a stale claim from an older new-thread session', () => {
    const current = session('new-thread-slot:project-1', 'new draft', 9);
    const transition = transitionChatComposerSession(current, chatComposerTargetIdentity('created-old', null), {
      fromIdentity: 'new-thread-slot:project-1',
      sessionId: 8,
      toIdentity: 'thread:created-old',
    }, 10);

    expect(transition.claimed).toBe(false);
    expect(transition.state).toEqual(session('thread:created-old', '', 10));
  });
});

function session(
  targetIdentity: ChatComposerSessionState['targetIdentity'],
  draft: string,
  sessionId: number,
): ChatComposerSessionState {
  return { draft, sessionId, targetIdentity };
}
