import type { ProviderConfigState, RuntimeFetchModelsInput } from '@setsuna-desktop/contracts';
import { useEffect, useRef, useState } from 'react';

export type ProviderConnectionTester = (input: RuntimeFetchModelsInput, signal: AbortSignal) => Promise<void>;

type TestResult = Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>;

export function useProviderConnectionTest(
  provider: ProviderConfigState,
  apiKey: string,
  testConnection: ProviderConnectionTester,
) {
  const input: RuntimeFetchModelsInput = {
    providerId: provider.id,
    catalogProviderId: provider.catalogProviderId ?? null,
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    proxyRoute: provider.proxyRoute,
    requestHeaders: provider.requestHeaders ?? null,
    apiKey: apiKey.trim() || undefined,
  };
  const connectionKey = JSON.stringify([input, input.apiKey ? null : provider.apiKeyPreview]);
  const currentKey = useRef(connectionKey);
  currentKey.current = connectionKey;
  const request = useRef<AbortController | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  useEffect(() => {
    setTesting(false);
    setResult(null);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [connectionKey]);

  const runTest = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setTesting(true);
    setResult(null);
    // Edits and navigation invalidate results even if transport finishes after cancellation.
    const isCurrent = () => !controller.signal.aborted && currentKey.current === connectionKey;
    try {
      await testConnection(input, controller.signal);
      if (isCurrent()) setResult({ ok: true });
    } catch (error) {
      if (isCurrent()) setResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (request.current === controller) {
        request.current = null;
        setTesting(false);
      }
    }
  };

  return { testing, result, runTest };
}
