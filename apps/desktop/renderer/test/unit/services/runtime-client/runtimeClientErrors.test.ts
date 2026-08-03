import { describe, expect, it, vi } from 'vitest';
import {
  isRuntimeTransportFailure,
  reportRuntimeBackgroundFailure,
  runtimeClientErrorMessage,
} from '../../../../src/services/runtime-client/runtimeClientErrors.js';

describe('runtime client errors', () => {
  it('recognizes both enriched and legacy Electron transport failures', () => {
    expect(isRuntimeTransportFailure(
      new Error('Runtime request transport failed (GET /v1/threads; cause=ECONNRESET).'),
    )).toBe(true);
    expect(isRuntimeTransportFailure(
      new Error("Error invoking remote method 'runtime:request': TypeError: fetch failed"),
    )).toBe(true);
    expect(isRuntimeTransportFailure(new Error('Thread not found'))).toBe(false);
  });

  it('keeps background failures in diagnostics instead of throwing', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new Error('temporary transport failure');

    expect(() => reportRuntimeBackgroundFailure('thread list refresh', error)).not.toThrow();
    expect(warning).toHaveBeenCalledWith(
      '[runtime] Background thread list refresh failed; keeping the last known state.',
      error,
    );
    warning.mockRestore();
  });

  it('normalizes non-Error rejection values', () => {
    expect(runtimeClientErrorMessage('unavailable')).toBe('unavailable');
  });
});
