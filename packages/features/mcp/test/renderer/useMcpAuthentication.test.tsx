// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { afterEach, expect, it, vi } from 'vitest';
import type { McpRendererService } from '../../src/contracts/index.js';
import { useMcpAuthentication } from '../../src/renderer/useMcpAuthentication.js';

afterEach(cleanup);

it('keeps remote cancellations silent while reporting real authentication failures and clearing them on retry', async () => {
  const login = vi.fn()
    .mockRejectedValueOnce(new FeatureOperationFailure({
      code: 'OPERATION_CANCELLED', message: 'Feature operation was cancelled.', retryable: false,
    }))
    .mockRejectedValueOnce(new Error('Authorization denied'))
    .mockResolvedValueOnce(undefined);
  const service = { login, refresh: vi.fn().mockResolvedValue(undefined) } as unknown as McpRendererService;
  const { result } = renderHook(() => useMcpAuthentication(service, (key) => key));
  await act(() => result.current.run('docs', 'login'));
  expect(result.current.errors.size).toBe(0);
  expect(result.current.pendingActions.size).toBe(0);
  await act(() => result.current.run('docs', 'login'));
  expect(result.current.errors.get('docs')).toBe('Authorization denied');
  await act(() => result.current.run('docs', 'login'));
  expect(result.current.errors.size).toBe(0);
  expect(result.current.pendingActions.size).toBe(0);
});
