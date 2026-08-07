import type {
  DesktopNetworkProxyRoutingInput,
  DesktopNetworkProxyServerInput,
  RuntimeConfigState,
} from '@setsuna-desktop/contracts';
import { ipcMain, type BrowserWindow } from 'electron';
import type { DesktopNetworkProxyService } from '../network-proxy/service.js';
import type { RuntimeHost } from '../runtime/host.js';

export function registerNetworkProxyIpc(
  service: DesktopNetworkProxyService,
  runtimeHost: RuntimeHost,
  mainWindow: BrowserWindow,
): () => void {
  const channels = [
    'network-proxy:get-state',
    'network-proxy:upsert-server',
    'network-proxy:delete-server',
    'network-proxy:set-routing',
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle('network-proxy:get-state', async () => service.getState());
  ipcMain.handle('network-proxy:upsert-server', async (_event, value) =>
    service.upsertServer(proxyServerInput(value)));
  ipcMain.handle('network-proxy:delete-server', async (_event, value) => {
    const proxyServerId = String(value ?? '').trim();
    await ensureNoProviderReferences(runtimeHost, proxyServerId);
    return service.deleteServer(proxyServerId);
  });
  ipcMain.handle('network-proxy:set-routing', async (_event, value) =>
    service.setRouting(routingInput(value)));

  return service.subscribe((state) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('network-proxy:state-change', state);
  });
}

function proxyServerInput(value: unknown): DesktopNetworkProxyServerInput {
  const input = recordInput(value);
  return {
    ...(typeof input.id === 'string' ? { id: input.id } : {}),
    name: typeof input.name === 'string' ? input.name : '',
    url: typeof input.url === 'string' ? input.url : '',
    ...(typeof input.username === 'string' ? { username: input.username } : {}),
    ...(typeof input.password === 'string' ? { password: input.password } : {}),
    ...(input.clearPassword === true ? { clearPassword: true } : {}),
  };
}

function routingInput(value: unknown): DesktopNetworkProxyRoutingInput {
  const input = recordInput(value);
  return {
    ...(input.global === undefined ? {} : { global: input.global as DesktopNetworkProxyRoutingInput['global'] }),
    ...(input.scopes === undefined ? {} : { scopes: input.scopes as DesktopNetworkProxyRoutingInput['scopes'] }),
  };
}

async function ensureNoProviderReferences(runtimeHost: RuntimeHost, proxyServerId: string): Promise<void> {
  const config = await runtimeHost.request<RuntimeConfigState>({ path: '/v1/config' });
  const providers = config.providers
    .filter((provider) => provider.proxyRoute?.mode === 'proxy'
      && provider.proxyRoute.proxyServerId === proxyServerId)
    .map((provider) => provider.name);
  if (providers.length) {
    throw new Error(`代理服务器仍被模型厂商 ${providers.join('、')} 使用，请先修改厂商代理。`);
  }
}

function recordInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
