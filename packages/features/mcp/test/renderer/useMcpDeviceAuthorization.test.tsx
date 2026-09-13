// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMcpDeviceAuthorization } from '../../src/renderer/useMcpDeviceAuthorization.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const challenge = { userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', expiresAt: '2026-09-13T12:00:00Z' };

describe('device authorization handoff', () => {
  it('waits for a user action, copies once before opening and keeps clipboard failures in the app', async () => {
    let finishCopy!: () => void;
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockImplementationOnce(() => new Promise<void>((resolve) => { finishCopy = resolve; }));
    const openExternal = vi.fn(async () => true);
    const { result, rerender } = renderHook(() => useMcpDeviceAuthorization(challenge, openExternal));
    expect(result.current.copied).toBe(false);
    rerender();
    expect(write).not.toHaveBeenCalled();
    let opening!: Promise<void>;
    act(() => { opening = result.current.open(); });
    expect(write).toHaveBeenCalledWith('ABCD-EFGH');
    expect(openExternal).not.toHaveBeenCalled();
    await act(async () => { await result.current.open(); });
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => { finishCopy(); await opening; });
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(challenge.verificationUri);
    expect(result.current.pending).toBe(false);

    write.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    await act(async () => { await result.current.open(); });
    expect(result.current.error).toBe('copy');
    expect(result.current.copied).toBe(false);
    expect(openExternal).toHaveBeenCalledTimes(1);

    write.mockResolvedValueOnce();
    openExternal.mockResolvedValueOnce(false);
    await act(async () => { await result.current.open(); });
    expect(result.current.error).toBe('open');
    expect(result.current.copied).toBe(true);
  });
});
