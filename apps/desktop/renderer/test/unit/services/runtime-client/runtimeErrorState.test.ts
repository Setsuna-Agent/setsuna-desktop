import { describe, expect, it } from 'vitest';
import {
  discardRuntimeErrorFromOtherThread,
  runtimeErrorForThread,
  updateScopedRuntimeError,
} from '../../../../src/services/runtime-client/runtimeErrorState.js';

describe('runtimeErrorState', () => {
  it('shows a new error in its source thread immediately', () => {
    const error = updateScopedRuntimeError(null, 'unauthorized client detected', 'thread_a');

    expect(runtimeErrorForThread(error, 'thread_a')).toBe('unauthorized client detected');
  });

  it('does not carry an old error into another thread or resurrect it later', () => {
    const sourceError = updateScopedRuntimeError(null, 'unauthorized client detected', 'thread_a');

    expect(runtimeErrorForThread(sourceError, 'thread_b')).toBeNull();
    const discarded = discardRuntimeErrorFromOtherThread(sourceError, 'thread_b');
    expect(discarded).toBeNull();
    expect(runtimeErrorForThread(discarded, 'thread_a')).toBeNull();
  });

  it('resolves functional updates against only the active thread error', () => {
    const sourceError = updateScopedRuntimeError(null, 'old error', 'thread_a');
    const updated = updateScopedRuntimeError(
      sourceError,
      (current) => current ?? 'thread_b error',
      'thread_b',
    );

    expect(runtimeErrorForThread(updated, 'thread_b')).toBe('thread_b error');
  });
});
