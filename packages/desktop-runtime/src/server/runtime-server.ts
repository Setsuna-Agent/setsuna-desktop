import http from 'node:http';
import { URL } from 'node:url';
import type { RuntimeHealth } from '@setsuna-desktop/contracts';
import { createRuntimeFactory } from '../runtime/runtime-factory.js';
import { APP_SERVER_DEFAULT_CONNECTION_ID, createAppServerCommandExecManager } from './app-server/command-exec.js';
import { createAppServerConnectionRegistry } from './app-server/connections.js';
import { createAppServerFsManager } from './app-server/fs-protocol.js';
import { handleAppServerRpcRequest } from './app-server/rpc.js';
import type { AppServerRpcRequest } from './app-server/rpc-types.js';
import { isAuthorized, readBody, sendJson } from './http-utils.js';
import { RuntimeHttpError } from './http-error.js';
import { handleRuntimeRestRequest } from './runtime-rest-routes.js';
import { handleAppServerNotificationSse, runtimeEventStreamExperimentalApi } from './sse.js';
import { settleStaleRuntimeTurns } from './runtime-thread-events.js';
import type { RuntimeServer, RuntimeServerOptions } from './types.js';

export type { RuntimeServer, RuntimeServerOptions } from './types.js';

/**
 * 创建本地 HTTP runtime，只允许 Electron main 通过 loopback + bearer token 访问。
 *
 * @param options runtime server 的数据目录、认证 token、版本和内置 skills 目录。
 */
export async function createRuntimeServer(options: RuntimeServerOptions): Promise<RuntimeServer> {
  const startedAt = new Date().toISOString();
  const runtime = createRuntimeFactory({
    dataDir: options.dataDir,
    builtinSkillsDir: options.builtinSkillsDir,
  });
  await runtime.threadStore.recover();
  // 上次异常退出留下的 streaming turn 要先结算，否则 renderer 会误判还有任务在跑。
  await settleStaleRuntimeTurns(runtime);
  // Recovery 完成后再排队历史记忆抽取，避免读取尚未结算的 turn；shutdown 会取消该后台队列。
  void runtime.agentLoop.runMemoryStartupExtraction().catch(() => undefined);
  const commandExecManager = createAppServerCommandExecManager(runtime.appServerNotificationBus, {
    ptyFactory: options.commandExecPtyFactory,
  });
  const fsManager = createAppServerFsManager(runtime.appServerNotificationBus);
  const appServerConnections = createAppServerConnectionRegistry();
  const sseResponses = new Set<http.ServerResponse>();
  let shuttingDown = false;
  let closingPromise: Promise<void> | null = null;
  const unsubscribeSkillChanges = runtime.skillRegistry.subscribeChanges(() => {
    runtime.appServerNotificationBus.publish({ method: 'skills/changed', params: {} });
  });
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (shuttingDown) {
        sendJson(response, 503, { error: 'Runtime is shutting down' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          service: 'setsuna-desktop-runtime',
          startedAt,
          version: options.version,
        } satisfies RuntimeHealth);
        return;
      }

      if (!isAuthorized(request, options.token)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/swe/app-server/events') {
        trackSseResponse(response, sseResponses);
        const explicitConnectionId = appServerConnectionId(request, url);
        const connectionId = explicitConnectionId ?? APP_SERVER_DEFAULT_CONNECTION_ID;
        handleAppServerNotificationSse({
          connectionId,
          experimentalApi: runtimeEventStreamExperimentalApi(
            url.searchParams.get('experimentalApi') ?? url.searchParams.get('experimental_api'),
          ) || appServerConnections.experimentalApi(connectionId),
          onClose: () => {
            fsManager.terminateConnection(connectionId);
            if (explicitConnectionId) commandExecManager.terminateConnection(connectionId);
          },
          response,
          runtime,
        });
        return;
      }

      if (request.method === 'GET' && /^\/v1\/threads\/[^/]+\/events$/u.test(url.pathname)) {
        trackSseResponse(response, sseResponses);
      }

      // app-server RPC 承载 Codex/SWE bridge 命令，和普通 runtime REST 路由分开处理。
      if (request.method === 'POST' && url.pathname === '/v1/swe/app-server') {
        const message = await readBody<AppServerRpcRequest>(request);
        const responseMessage = await handleAppServerRpcRequest(
          runtime,
          message,
          options,
          commandExecManager,
          fsManager,
          appServerConnectionId(request, url) ?? APP_SERVER_DEFAULT_CONNECTION_ID,
          appServerConnections,
        );
        if (!responseMessage) {
          response.writeHead(204);
          response.end();
          return;
        }
        sendJson(response, 200, responseMessage);
        return;
      }

      if (await handleRuntimeRestRequest(runtime, request, response, url)) return;

      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(response, error instanceof RuntimeHttpError ? error.statusCode : 500, {
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof RuntimeHttpError && error.code ? { code: error.code } : {}),
      });
    }
  });

  return {
    listen: (port) => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)),
    close: () => {
      if (closingPromise) return closingPromise;
      shuttingDown = true;
      closingPromise = (async () => {
        // Stop accepting requests first, then close long-lived streams so the
        // server callback can complete while background turns are draining.
        const serverClosed = server.listening
          ? new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
          : Promise.resolve();
        for (const response of sseResponses) response.end();
        sseResponses.clear();
        server.closeAllConnections();
        unsubscribeSkillChanges();
        commandExecManager.terminateAll();
        fsManager.terminateAll();
        await runtime.agentLoop.shutdown();
        await runtime.eventWriter.flushAll();
        await runtime.threadStore.flush();
        await serverClosed;
      })();
      return closingPromise;
    },
    address: () => server.address(),
  };
}

function trackSseResponse(response: http.ServerResponse, responses: Set<http.ServerResponse>): void {
  responses.add(response);
  response.once('close', () => responses.delete(response));
}

function appServerConnectionId(request: http.IncomingMessage, url: URL): string | undefined {
  const rawHeader = firstHeaderValue(
    request.headers['x-setsuna-app-server-connection-id']
    ?? request.headers['x-setsuna-app-server-session']
    ?? request.headers['x-codex-app-server-connection-id'],
  );
  const rawQuery = url.searchParams.get('connectionId')
    ?? url.searchParams.get('connection_id')
    ?? url.searchParams.get('sessionId')
    ?? url.searchParams.get('session_id');
  const normalized = (rawHeader ?? rawQuery ?? '').trim();
  return normalized || undefined;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
