import { parseRuntimeApiRequest } from '@setsuna-desktop/contracts';
import type { SandboxedUiFrameProps } from '@setsuna-desktop/feature-ui-card/contracts';
import { useCallback, useEffect, useMemo } from 'react';

export function useSandboxedRuntimeRequests(
  request: SandboxedUiFrameProps['onRuntimeRequest'],
  post: (message: Record<string, unknown>) => void,
  source: string,
) {
  // A replaced/unmounted document must neither retain requests nor receive a
  // previous document's response, even when the iframe WindowProxy is reused.
  const lifetime = useMemo(() => ({ controller: new AbortController() }), [request, source]);
  useEffect(() => {
    // React StrictMode can replay effect setup after cleaning up the same mount.
    if (lifetime.controller.signal.aborted) lifetime.controller = new AbortController();
    return () => lifetime.controller.abort();
  }, [lifetime]);
  return useCallback((requestId: string, input: unknown) => {
    const controller = lifetime.controller;
    void (async () => {
      try {
        if (!request) throw new Error('Runtime API is available only to installed sidebar applications.');
        const result = await request(parseRuntimeApiRequest(input), controller.signal);
        if (!controller.signal.aborted) post({ type: 'runtime-result', requestId, ok: true, result });
      } catch (error) {
        if (!controller.signal.aborted) post({
          type: 'runtime-result', requestId, ok: false,
          error: error instanceof Error ? error.message : 'Runtime API request failed.',
        });
      }
    })();
  }, [lifetime, post, request]);
}
