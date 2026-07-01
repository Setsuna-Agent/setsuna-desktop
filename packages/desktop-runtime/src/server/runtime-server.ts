import http from 'node:http';
import { URL } from 'node:url';
import type { RuntimeHealth } from '@setsuna-desktop/contracts';
import { createRuntimeFactory } from '../runtime/runtime-factory.js';
import { createAppServerCommandExecManager } from './app-server/command-exec.js';
import { handleAppServerRpcRequest } from './app-server/rpc.js';
import type { AppServerRpcRequest } from './app-server/rpc-types.js';
import { isAuthorized, readBody, sendJson } from './http-utils.js';
import { handleRuntimeRestRequest } from './runtime-rest-routes.js';
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
  // 上次异常退出留下的 streaming turn 要先结算，否则 renderer 会误判还有任务在跑。
  await settleStaleRuntimeTurns(runtime);
  const commandExecManager = createAppServerCommandExecManager();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
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

      // app-server RPC 承载 Codex/SWE bridge 命令，和普通 runtime REST 路由分开处理。
      if (request.method === 'POST' && url.pathname === '/v1/swe/app-server') {
        const message = await readBody<AppServerRpcRequest>(request);
        const responseMessage = await handleAppServerRpcRequest(runtime, message, options, commandExecManager);
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
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return {
    listen: (port) => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)),
    close: async () => {
      // server 关闭时必须先停掉 shell/命令执行器，避免子进程脱离 runtime 生命周期。
      commandExecManager.terminateAll();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
    address: () => server.address(),
  };
}
