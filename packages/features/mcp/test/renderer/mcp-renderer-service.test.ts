import type { RuntimeMcpServerList } from '@setsuna-desktop/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it, vi } from 'vitest';
import { mcpFeature } from '../../src/contracts/index.js';
import type { McpRendererClient } from '../../src/renderer/client.js';
import { RendererMcpService } from '../../src/renderer/index.js';

describe('RendererMcpService', () => {
  it('does not let a slow refresh roll back a newer mutation snapshot', async () => {
    const staleRefresh = deferred<RuntimeMcpServerList>();
    const savedSnapshot = snapshot('saved');
    const client = {
      readServers: vi.fn(() => staleRefresh.promise),
      saveServer: vi.fn(async () => savedSnapshot),
    } as unknown as McpRendererClient;
    const scope = createFeatureScope({
      featureId: mcpFeature.id,
      process: 'renderer',
      scopeId: 'mcp-renderer-service-test',
    });
    scope.activate();
    const service = new RendererMcpService({ client, scope: scope.scope });
    const listener = vi.fn();
    service.subscribe(listener);

    const refresh = service.refresh();
    await service.saveServer({ command: 'node', key: 'saved', transport: 'stdio' });
    staleRefresh.resolve(snapshot('stale'));
    await refresh;

    expect(service.getSnapshot()).toEqual(savedSnapshot);
    expect(listener).toHaveBeenCalledOnce();

    await scope.finishDispose();
  });

  it('waits for an earlier mutation before refreshing the server list', async () => {
    const saveCommit = deferred<RuntimeMcpServerList>();
    let committedSnapshot = snapshot('stale');
    const client = {
      readServers: vi.fn(async () => committedSnapshot),
      saveServer: vi.fn(async () => {
        committedSnapshot = await saveCommit.promise;
        return committedSnapshot;
      }),
    } as unknown as McpRendererClient;
    const scope = createFeatureScope({
      featureId: mcpFeature.id,
      process: 'renderer',
      scopeId: 'mcp-renderer-service-mutation-first-test',
    });
    scope.activate();
    const service = new RendererMcpService({ client, scope: scope.scope });

    const save = service.saveServer({ command: 'node', key: 'saved', transport: 'stdio' });
    const refresh = service.refresh();
    expect(client.readServers).not.toHaveBeenCalled();

    const savedSnapshot = snapshot('saved');
    saveCommit.resolve(savedSnapshot);
    await Promise.all([save, refresh]);

    expect(client.readServers).toHaveBeenCalledOnce();
    expect(service.getSnapshot()).toEqual(savedSnapshot);

    await scope.finishDispose();
  });

  it('merges completed authentication into concurrently updated server configuration', async () => {
    const loginResult = deferred<RuntimeMcpServerList>();
    let committedSnapshot = snapshot('oauth-server', true, 'notLoggedIn');
    const client = {
      login: vi.fn(() => loginResult.promise),
      readServers: vi.fn(async () => committedSnapshot),
      updateServer: vi.fn(async () => {
        committedSnapshot = snapshot('oauth-server', false, 'oAuthLoggingIn', 'waiting');
        return committedSnapshot;
      }),
    } as unknown as McpRendererClient;
    const scope = createFeatureScope({
      featureId: mcpFeature.id,
      process: 'renderer',
      scopeId: 'mcp-renderer-service-authentication-test',
    });
    scope.activate();
    const service = new RendererMcpService({ client, scope: scope.scope });
    await service.refresh();

    const login = service.login('oauth-server');
    await vi.waitFor(() => expect(client.login).toHaveBeenCalledOnce());
    const update = service.updateServer('oauth-server', { enabled: false });
    await vi.waitFor(() => expect(client.updateServer).toHaveBeenCalledOnce());
    await update;
    await service.refresh();

    expect(service.getSnapshot()?.servers[0]?.enabled).toBe(false);
    loginResult.resolve(snapshot('oauth-server', true, 'oAuth'));
    await login;
    expect(service.getSnapshot()?.servers[0]).toMatchObject({
      authStatus: 'oAuth',
      enabled: false,
    });
    expect(service.getSnapshot()?.servers[0]?.authError).toBeUndefined();

    await scope.finishDispose();
  });

  it('does not let a stale mutation response roll back completed authentication', async () => {
    const loginResult = deferred<RuntimeMcpServerList>();
    const updateResult = deferred<RuntimeMcpServerList>();
    const client = {
      login: vi.fn(() => loginResult.promise),
      readServers: vi.fn(async () => snapshot('oauth-server', true, 'notLoggedIn')),
      updateServer: vi.fn(() => updateResult.promise),
    } as unknown as McpRendererClient;
    const scope = createFeatureScope({
      featureId: mcpFeature.id,
      process: 'renderer',
      scopeId: 'mcp-renderer-service-stale-mutation-auth-test',
    });
    scope.activate();
    const service = new RendererMcpService({ client, scope: scope.scope });
    await service.refresh();

    const login = service.login('oauth-server');
    await vi.waitFor(() => expect(client.login).toHaveBeenCalledOnce());
    const update = service.updateServer('oauth-server', { enabled: false });
    await vi.waitFor(() => expect(client.updateServer).toHaveBeenCalledOnce());

    loginResult.resolve(snapshot('oauth-server', true, 'oAuth'));
    await login;
    updateResult.resolve(snapshot('oauth-server', false, 'oAuthLoggingIn', 'waiting'));
    await update;

    expect(service.getSnapshot()?.servers[0]).toMatchObject({
      authStatus: 'oAuth',
      enabled: false,
    });
    expect(service.getSnapshot()?.servers[0]?.authError).toBeUndefined();

    await scope.finishDispose();
  });
});

function snapshot(
  serverKey: string,
  enabled = true,
  authStatus?: RuntimeMcpServerList['servers'][number]['authStatus'],
  authError?: string,
): RuntimeMcpServerList {
  return {
    configPath: '/tmp/mcp.json',
    errors: [],
    servers: [{
      enabled,
      key: serverKey,
      ...(authStatus ? { authStatus } : {}),
      ...(authError ? { authError } : {}),
    }] as RuntimeMcpServerList['servers'],
    workspaceConfigPaths: [],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
