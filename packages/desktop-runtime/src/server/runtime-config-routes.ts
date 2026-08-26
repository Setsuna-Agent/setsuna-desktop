import type { RuntimeFetchModelsInput } from '@setsuna-desktop/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { fetchAvailableModels } from '../adapters/model/model-discovery.js';
import { ProviderProxyReferenceError } from '../adapters/store/file-config-store.js';
import { RuntimeHttpError } from './http-error.js';
import { readBody, sendJson } from './http-utils.js';
import type { RuntimeFactory } from './types.js';

export async function handleRuntimeConfigRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/v1/config') {
    sendJson(response, 200, await runtime.configStore.getConfig());
    return true;
  }

  if (request.method === 'PUT' && url.pathname === '/v1/config') {
    sendJson(response, 200, await runtime.configStore.saveConfig(await readBody(request)));
    return true;
  }

  const deletedProxyServerId = networkProxyDeleteId(url.pathname);
  if (request.method === 'DELETE' && deletedProxyServerId) {
    try {
      const state = await runtime.configStore.deleteProxyServerIfUnreferenced(
        deletedProxyServerId,
        () => runtime.nativeBridge.deleteNetworkProxy(deletedProxyServerId),
      );
      sendJson(response, 200, state);
    } catch (error) {
      if (error instanceof ProviderProxyReferenceError) {
        throw new RuntimeHttpError(409, error.message, 'network_proxy_in_use');
      }
      throw error;
    }
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/config/models') {
    const input = await readBody<RuntimeFetchModelsInput>(request, {});
    const savedProvider = input.providerId
      ? await runtime.configStore.getProviderConfig(input.providerId)
      : await runtime.configStore.getActiveProviderConfig();
    sendJson(response, 200, {
      models: await fetchAvailableModels(
        input,
        savedProvider,
        runtime.networkProxyFetch.forRoute(input.proxyRoute ?? savedProvider?.proxyRoute),
      ),
    });
    return true;
  }

  return false;
}

function networkProxyDeleteId(pathname: string): string | null {
  const match = /^\/v1\/config\/network-proxy\/([^/]+)$/u.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const proxyServerId = decodeURIComponent(match[1]).trim();
    return proxyServerId || null;
  } catch {
    throw new RuntimeHttpError(400, 'Network proxy server ID is invalid.');
  }
}
