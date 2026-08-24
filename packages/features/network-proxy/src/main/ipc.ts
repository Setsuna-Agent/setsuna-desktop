import type {
  DesktopNetworkProxyRoutingInput,
  DesktopNetworkProxyServerInput,
} from '@setsuna-desktop/contracts';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { NETWORK_PROXY_IPC_CHANNELS } from '../contracts/index.js';
import type { DesktopNetworkProxyService } from './service.js';

export function registerNetworkProxyIpc(
  scope: FeatureScope,
  service: DesktopNetworkProxyService,
  mainWindow: BrowserWindow,
  deleteServerThroughRuntime: (proxyServerId: string) => Promise<unknown>,
): () => void {
  const channels = [
    NETWORK_PROXY_IPC_CHANNELS.getState,
    NETWORK_PROXY_IPC_CHANNELS.upsertServer,
    NETWORK_PROXY_IPC_CHANNELS.deleteServer,
    NETWORK_PROXY_IPC_CHANNELS.setRouting,
  ] as const;
  for (const channel of channels) ipcMain.removeHandler(channel);

  registerScopedHandler(scope, NETWORK_PROXY_IPC_CHANNELS.getState, () => service.getState());
  registerScopedHandler(scope, NETWORK_PROXY_IPC_CHANNELS.upsertServer, (_event, value) => (
    service.upsertServer(proxyServerInput(value))
  ));
  registerScopedHandler(scope, NETWORK_PROXY_IPC_CHANNELS.deleteServer, (_event, value) => {
    const proxyServerId = String(value ?? '').trim();
    return deleteServerThroughRuntime(proxyServerId);
  });
  registerScopedHandler(scope, NETWORK_PROXY_IPC_CHANNELS.setRouting, (_event, value) => (
    service.setRouting(routingInput(value))
  ));

  const unsubscribe = service.subscribe((state) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(NETWORK_PROXY_IPC_CHANNELS.stateChange, state);
    }
  });
  return () => {
    unsubscribe();
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}

type NetworkProxyIpcHandler = (
  event: IpcMainInvokeEvent,
  input: unknown,
) => unknown | PromiseLike<unknown>;

function registerScopedHandler(
  scope: FeatureScope,
  channel: string,
  handler: NetworkProxyIpcHandler,
): void {
  ipcMain.handle(channel, (event, input: unknown) => (
    scope.runOperation(() => handler(event, input))
  ));
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

function recordInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
