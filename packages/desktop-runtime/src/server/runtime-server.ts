import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { URL } from 'node:url';
import type {
  AnswerRuntimeApprovalInput,
  SweTurn,
  CreateRuntimeMemoryInput,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpServerPatch,
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RegenerateMessageInput,
  RuntimeMemoryQuery,
  RuntimeHealth,
  SweNotification,
  ProviderConfigState,
  RuntimeFetchModelsInput,
  RuntimeConfigState,
  RuntimeConfigInput,
  RuntimeEvent,
  RuntimeGitInfo,
  RuntimeMessage,
  RuntimeThread,
  RuntimeThreadGoal,
  RuntimeThreadGoalStatus,
  RuntimeUsageQuery,
  SendTurnInput,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';
import { createSweNotificationMapper, runtimeThreadToSweTurns } from '@setsuna-desktop/contracts';
import { fetchMcpServerTools } from '../adapters/mcp/mcp-tool-discovery.js';
import { fetchAvailableModels } from '../adapters/model/model-discovery.js';
import { createRuntimeFactory } from '../runtime/runtime-factory.js';

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const APP_SERVER_COMMAND_EXEC_DEFAULT_OUTPUT_BYTES_CAP = 1024 * 1024;
const APP_SERVER_COMMAND_EXEC_DEFAULT_TIMEOUT_MS = 120_000;
const APP_SERVER_COMMAND_EXEC_TIMEOUT_EXIT_CODE = 124;

export type RuntimeServerOptions = {
  dataDir: string;
  token: string;
  version: string;
};

export type RuntimeServer = {
  listen(port: number): Promise<void>;
  close(): Promise<void>;
  address(): string | AddressInfo | null;
};

export async function createRuntimeServer(options: RuntimeServerOptions): Promise<RuntimeServer> {
  const startedAt = new Date().toISOString();
  const runtime = createRuntimeFactory({ dataDir: options.dataDir });
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

      if (request.method === 'GET' && url.pathname === '/v1/config') {
        sendJson(response, 200, await runtime.configStore.getConfig());
        return;
      }

      if (request.method === 'PUT' && url.pathname === '/v1/config') {
        sendJson(response, 200, await runtime.configStore.saveConfig(await readBody(request)));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/config/models') {
        const input = await readBody<RuntimeFetchModelsInput>(request, {});
        const activeProvider = await runtime.configStore.getActiveProviderConfig();
        const savedProvider = !input.providerId || activeProvider?.id === input.providerId ? activeProvider : null;
        sendJson(response, 200, { models: await fetchAvailableModels(input, savedProvider) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/threads') {
        const query: ThreadQuery = {
          search: url.searchParams.get('search') ?? undefined,
          includeArchived: url.searchParams.get('includeArchived') === 'true',
          scope: threadScope(url.searchParams.get('scope')),
          projectId: url.searchParams.get('projectId') ?? undefined,
        };
        sendJson(response, 200, { threads: await runtime.threadStore.listThreads(query) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/skills') {
        sendJson(response, 200, await runtime.skillRegistry.listSkills());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/skills') {
        sendJson(response, 201, await runtime.skillRegistry.createSkill(await readBody(request)));
        return;
      }

      const skillMatch = url.pathname.match(/^\/v1\/skills\/([^/]+)$/);
      if (skillMatch && request.method === 'GET') {
        const skill = await runtime.skillRegistry.getSkill(decodeURIComponent(skillMatch[1]));
        if (!skill) {
          sendJson(response, 404, { error: 'Skill not found' });
          return;
        }
        sendJson(response, 200, skill);
        return;
      }

      if (skillMatch && request.method === 'PATCH') {
        const skill = await runtime.skillRegistry.updateSkill(decodeURIComponent(skillMatch[1]), await readBody(request));
        sendJson(response, 200, skill);
        return;
      }

      if (skillMatch && request.method === 'DELETE') {
        await runtime.skillRegistry.deleteSkill(decodeURIComponent(skillMatch[1]));
        sendJson(response, 204, {});
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/projects') {
        sendJson(response, 200, await runtime.workspaceProjects.listProjects());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/projects') {
        sendJson(response, 201, await runtime.workspaceProjects.addProject(await readBody(request)));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/workspace/status') {
        sendJson(response, 200, await runtime.workspaceProjects.getStatus(url.searchParams.get('projectId') ?? undefined));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/usage') {
        const query: RuntimeUsageQuery = {
          threadId: url.searchParams.get('threadId') ?? undefined,
          limit: optionalNumber(url.searchParams.get('limit')),
        };
        sendJson(response, 200, await runtime.usageStore.getUsage(query));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/approvals') {
        sendJson(response, 200, await runtime.approvalGate.listApprovals());
        return;
      }

      const approvalMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/);
      if (approvalMatch && request.method === 'POST') {
        await runtime.approvalGate.answerApproval(
          decodeURIComponent(approvalMatch[1]),
          await readBody<AnswerRuntimeApprovalInput>(request),
        );
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/memories') {
        const query: RuntimeMemoryQuery = {
          scope: memoryScope(url.searchParams.get('scope')),
          projectId: url.searchParams.get('projectId') ?? undefined,
          search: url.searchParams.get('search') ?? undefined,
          limit: optionalNumber(url.searchParams.get('limit')),
        };
        sendJson(response, 200, await runtime.memoryStore.listMemories(query));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/memories/preview') {
        sendJson(response, 200, await runtime.memoryStore.previewMemories());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/memories') {
        const memory = await runtime.memoryStore.rememberMemory(await readBody<CreateRuntimeMemoryInput>(request));
        sendJson(response, 201, { memories: [memory] });
        return;
      }

      if (request.method === 'DELETE' && url.pathname === '/v1/memories') {
        await runtime.memoryStore.clearMemories();
        sendJson(response, 200, { memories: [] });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/mcp/servers') {
        sendJson(response, 200, await runtime.mcpStore.listServers());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/mcp/tools') {
        sendJson(response, 200, await fetchMcpServerTools(await readBody<RuntimeMcpServerInput>(request)));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/mcp/servers') {
        sendJson(response, 201, await runtime.mcpStore.upsertServer(await readBody<RuntimeMcpServerInput>(request)));
        return;
      }

      const mcpServerMatch = url.pathname.match(/^\/v1\/mcp\/servers\/([^/]+)$/);
      if (mcpServerMatch && request.method === 'PATCH') {
        sendJson(
          response,
          200,
          await runtime.mcpStore.updateServer(
            decodeURIComponent(mcpServerMatch[1]),
            await readBody<RuntimeMcpServerPatch>(request),
          ),
        );
        return;
      }

      if (mcpServerMatch && request.method === 'DELETE') {
        await runtime.mcpStore.deleteServer(decodeURIComponent(mcpServerMatch[1]));
        sendJson(response, 200, { ok: true });
        return;
      }

      const memoryMatch = url.pathname.match(/^\/v1\/memories\/([^/]+)$/);
      if (memoryMatch && request.method === 'DELETE') {
        await runtime.memoryStore.deleteMemory(decodeURIComponent(memoryMatch[1]));
        sendJson(response, 200, { ok: true });
        return;
      }

      const projectMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)$/);
      if (projectMatch && request.method === 'DELETE') {
        await runtime.workspaceProjects.removeProject(decodeURIComponent(projectMatch[1]));
        sendJson(response, 200, { ok: true });
        return;
      }

      const projectFilesMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/files$/);
      if (projectFilesMatch && request.method === 'GET') {
        sendJson(
          response,
          200,
          await runtime.workspaceProjects.listEntries(
            decodeURIComponent(projectFilesMatch[1]),
            url.searchParams.get('path') ?? '.',
          ),
        );
        return;
      }

      const projectEntriesSearchMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/entries\/search$/);
      if (projectEntriesSearchMatch && request.method === 'GET') {
        sendJson(
          response,
          200,
          await runtime.workspaceProjects.searchEntries(
            decodeURIComponent(projectEntriesSearchMatch[1]),
            url.searchParams.get('q') ?? '',
            url.searchParams.has('parent') ? url.searchParams.get('parent') : undefined,
          ),
        );
        return;
      }

      const projectReadMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/read$/);
      if (projectReadMatch && request.method === 'GET') {
        sendJson(
          response,
          200,
          await runtime.workspaceProjects.readFile(
            decodeURIComponent(projectReadMatch[1]),
            url.searchParams.get('path') ?? '',
          ),
        );
        return;
      }

      const projectSearchMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/search$/);
      if (projectSearchMatch && request.method === 'GET') {
        sendJson(
          response,
          200,
          await runtime.workspaceProjects.search(
            decodeURIComponent(projectSearchMatch[1]),
            url.searchParams.get('q') ?? '',
          ),
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/threads') {
        const thread = await runtime.threadStore.createThread(await readBody<CreateThreadInput>(request, {}));
        sendJson(response, 201, thread);
        return;
      }

      const threadMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)$/);
      if (threadMatch && request.method === 'GET') {
        const thread = await runtime.threadStore.getThread(decodeURIComponent(threadMatch[1]));
        if (!thread) {
          sendJson(response, 404, { error: 'Thread not found' });
          return;
        }
        sendJson(response, 200, thread);
        return;
      }

      if (threadMatch && request.method === 'PATCH') {
        const thread = await runtime.threadStore.updateThread(
          decodeURIComponent(threadMatch[1]),
          await readBody<ThreadPatch>(request),
        );
        sendJson(response, 200, thread);
        return;
      }

      const messageMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages\/([^/]+)$/);
      if (messageMatch && request.method === 'PATCH') {
        const threadId = decodeURIComponent(messageMatch[1]);
        const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
        const thread = await runtime.threadStore.updateMessage(
          threadId,
          decodeURIComponent(messageMatch[2]),
          await readBody<MessagePatch>(request),
        );
        await publishThreadEventsSince(runtime, threadId, beforeSeq);
        sendJson(response, 200, thread);
        return;
      }

      const messagesMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages$/);
      if (messagesMatch && request.method === 'DELETE') {
        const threadId = decodeURIComponent(messagesMatch[1]);
        const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
        const thread = await runtime.threadStore.deleteMessages(threadId, await readBody<MessageDeleteInput>(request));
        await publishThreadEventsSince(runtime, threadId, beforeSeq);
        sendJson(response, 200, thread);
        return;
      }

      const regenerateMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages\/([^/]+)\/regenerate$/);
      if (regenerateMatch && request.method === 'POST') {
        const threadId = decodeURIComponent(regenerateMatch[1]);
        const input = await readBody<RegenerateMessageInput>(request, {});
        sendJson(
          response,
          202,
          await runtime.agentLoop.regenerateFromMessage(threadId, decodeURIComponent(regenerateMatch[2]), {
            content: typeof input.content === 'string' ? input.content : undefined,
            skillIds: Array.isArray(input.skillIds) ? input.skillIds.filter((item): item is string => typeof item === 'string') : [],
            thinking: typeof input.thinking === 'boolean' ? input.thinking : undefined,
            thinkingEffort: stringInput((input as { thinking_effort?: unknown }).thinking_effort ?? input.thinkingEffort),
          }),
        );
        return;
      }

      const clearContextMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/context$/);
      if (clearContextMatch && request.method === 'DELETE') {
        const threadId = decodeURIComponent(clearContextMatch[1]);
        const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
        const thread = await runtime.threadStore.clearThreadMessages(threadId);
        await publishThreadEventsSince(runtime, threadId, beforeSeq);
        sendJson(response, 200, thread);
        return;
      }

      const compactContextMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/context\/compact$/);
      if (compactContextMatch && request.method === 'POST') {
        const threadId = decodeURIComponent(compactContextMatch[1]);
        sendJson(response, 200, await runtime.agentLoop.compactThreadContext(threadId, true));
        return;
      }

      const turnMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/turns$/);
      if (turnMatch && request.method === 'POST') {
        const threadId = decodeURIComponent(turnMatch[1]);
        const input = await readBody<{ attachments?: unknown; input?: unknown; skillIds?: unknown; thinking?: unknown; thinkingEffort?: unknown; thinking_effort?: unknown }>(request);
        const text = typeof input.input === 'string' ? input.input : '';
        const skillIds = Array.isArray(input.skillIds) ? input.skillIds.filter((item): item is string => typeof item === 'string') : [];
        const attachments: SendTurnInput['attachments'] = Array.isArray(input.attachments)
          ? input.attachments.filter(isRuntimeMessageAttachment)
          : [];
        sendJson(response, 202, await runtime.agentLoop.startTurn(threadId, {
          attachments,
          input: text,
          skillIds,
          thinking: typeof input.thinking === 'boolean' ? input.thinking : undefined,
          thinkingEffort: stringInput(input.thinking_effort ?? input.thinkingEffort),
        } satisfies SendTurnInput));
        return;
      }

      const cancelTurnMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/turns\/([^/]+)\/cancel$/);
      if (cancelTurnMatch && request.method === 'POST') {
        const cancelled = await cancelRuntimeTurn(
          runtime,
          decodeURIComponent(cancelTurnMatch[1]),
          decodeURIComponent(cancelTurnMatch[2]),
        );
        sendJson(response, 200, { ok: true, cancelled });
        return;
      }

      const eventsMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/events$/);
      if (eventsMatch && request.method === 'GET') {
        const threadId = decodeURIComponent(eventsMatch[1]);
        const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? '0') || 0;
        const format = runtimeEventStreamFormat(url.searchParams.get('format'));
        await handleSse({
          format,
          response,
          threadId,
          sinceSeq,
          runtime,
        });
        return;
      }

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
      commandExecManager.terminateAll();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
    address: () => server.address(),
  };
}

type RuntimeFactory = ReturnType<typeof createRuntimeFactory>;

type AppServerRpcRequest = {
  id?: string | number | null;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

type AppServerRpcResponse =
  | { id: string | number | null; result: unknown }
  | { id: string | number | null; error: { code: number; message: string; data?: unknown } };

type AppServerCommandExecResponse = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type AppServerCommandExecParams = {
  command: string[];
  processId?: string;
  tty: boolean;
  streamStdin: boolean;
  streamStdoutStderr: boolean;
  outputBytesCap?: number;
  disableOutputCap: boolean;
  disableTimeout: boolean;
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string | null>;
  size?: unknown;
  sandboxPolicy?: unknown;
  permissionProfile?: unknown;
};

type AppServerCommandExecManager = {
  exec(params: unknown): Promise<AppServerCommandExecResponse>;
  write(params: unknown): Promise<Record<string, never>>;
  terminate(params: unknown): Promise<Record<string, never>>;
  resize(params: unknown): Promise<Record<string, never>>;
  terminateAll(): void;
};

type AppServerCommandExecSession = {
  child: ChildProcessWithoutNullStreams;
  processId: string;
  streamStdin: boolean;
  stdinClosed: boolean;
  timedOut: boolean;
};

type AppServerCommandExecOutputBuffer = {
  chunks: Buffer[];
  capturedBytes: number;
  capBytes: number | null;
};

function createAppServerCommandExecManager(): AppServerCommandExecManager {
  const sessions = new Map<string, AppServerCommandExecSession>();

  return {
    exec: (params) => execAppServerCommand(params, sessions),
    write: async (params) => {
      const input = recordInput(params);
      const processId = requiredString(input.processId ?? input.process_id, 'processId');
      const deltaBase64 = input.deltaBase64 ?? input.delta_base64;
      const closeStdin = input.closeStdin === true || input.close_stdin === true;
      if (deltaBase64 === undefined && !closeStdin) {
        throw new AppServerRpcError(-32602, 'command/exec/write requires deltaBase64 or closeStdin');
      }
      const session = requireAppServerCommandExecSession(sessions, processId);
      if (!session.streamStdin) {
        throw new AppServerRpcError(-32600, 'stdin streaming is not enabled for this command/exec');
      }
      const delta = deltaBase64 === undefined || deltaBase64 === null
        ? Buffer.alloc(0)
        : strictBase64Decode(deltaBase64, 'deltaBase64');
      if (delta.byteLength) {
        if (session.stdinClosed || session.child.stdin.destroyed || session.child.stdin.writableEnded) {
          throw new AppServerRpcError(-32600, 'stdin is already closed');
        }
        session.child.stdin.write(delta);
      }
      if (closeStdin && !session.stdinClosed) {
        session.stdinClosed = true;
        session.child.stdin.end();
      }
      return {};
    },
    terminate: async (params) => {
      const input = recordInput(params);
      const session = requireAppServerCommandExecSession(sessions, requiredString(input.processId ?? input.process_id, 'processId'));
      terminateAppServerCommandExecSession(session);
      return {};
    },
    resize: async (params) => {
      const input = recordInput(params);
      requireAppServerCommandExecSession(sessions, requiredString(input.processId ?? input.process_id, 'processId'));
      const size = recordInput(input.size);
      const rows = numericInput(size.rows);
      const cols = numericInput(size.cols);
      if (rows === undefined || cols === undefined || rows < 1 || cols < 1) {
        throw new AppServerRpcError(-32602, 'command/exec size rows and cols must be greater than 0');
      }
      throw new AppServerRpcError(-32600, 'command/exec/resize requires tty support, which is not available on the HTTP app-server adapter');
    },
    terminateAll: () => {
      for (const session of sessions.values()) terminateAppServerCommandExecSession(session);
      sessions.clear();
    },
  };
}

async function execAppServerCommand(
  rawParams: unknown,
  sessions: Map<string, AppServerCommandExecSession>,
): Promise<AppServerCommandExecResponse> {
  const params = appServerCommandExecParams(rawParams);
  if (params.command.length === 0) throw new AppServerRpcError(-32600, 'command must not be empty');
  if (params.sandboxPolicy !== undefined && params.permissionProfile !== undefined) {
    throw new AppServerRpcError(-32600, '`permissionProfile` cannot be combined with `sandboxPolicy`');
  }
  if (params.size !== undefined && !params.tty) {
    throw new AppServerRpcError(-32602, 'command/exec size requires tty: true');
  }
  if (params.disableOutputCap && params.outputBytesCap !== undefined) {
    throw new AppServerRpcError(-32602, 'command/exec cannot set both outputBytesCap and disableOutputCap');
  }
  if (params.disableTimeout && params.timeoutMs !== undefined) {
    throw new AppServerRpcError(-32602, 'command/exec cannot set both timeoutMs and disableTimeout');
  }
  if (!params.processId && (params.tty || params.streamStdin || params.streamStdoutStderr)) {
    throw new AppServerRpcError(-32600, 'command/exec tty or streaming requires a client-supplied processId');
  }
  if (params.tty || params.streamStdoutStderr) {
    throw new AppServerRpcError(
      -32600,
      'command/exec streaming stdout/stderr requires server notifications, which are not available on the HTTP app-server adapter',
    );
  }
  if (params.processId && sessions.has(params.processId)) {
    throw new AppServerRpcError(-32600, `duplicate active command/exec process id: ${JSON.stringify(params.processId)}`);
  }

  const [program, ...args] = params.command;
  const stdout = createAppServerOutputBuffer(params);
  const stderr = createAppServerOutputBuffer(params);
  const env = appServerCommandExecEnv(params.env);
  const cwd = path.resolve(process.cwd(), params.cwd ?? '.');

  return await new Promise<AppServerCommandExecResponse>((resolve, reject) => {
    let finished = false;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    let session: AppServerCommandExecSession | undefined;

    const cleanup = () => {
      if (finished) return false;
      finished = true;
      if (timeout) clearTimeout(timeout);
      if (session) sessions.delete(session.processId);
      return true;
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(program, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: 'pipe',
      });
    } catch (error) {
      reject(new AppServerRpcError(-32603, `failed to spawn command: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    if (params.processId) {
      session = {
        child,
        processId: params.processId,
        streamStdin: params.streamStdin,
        stdinClosed: false,
        timedOut: false,
      };
      sessions.set(params.processId, session);
    }

    child.stdout.on('data', (chunk: Buffer) => appendAppServerOutputBuffer(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => appendAppServerOutputBuffer(stderr, chunk));
    child.on('error', (error) => {
      cleanup();
      reject(new AppServerRpcError(-32603, `failed to spawn command: ${error.message}`));
    });
    child.on('close', (code) => {
      if (!cleanup()) return;
      resolve({
        exitCode: timedOut || session?.timedOut ? APP_SERVER_COMMAND_EXEC_TIMEOUT_EXIT_CODE : code ?? -1,
        stdout: Buffer.concat(stdout.chunks).toString('utf8'),
        stderr: Buffer.concat(stderr.chunks).toString('utf8'),
      });
    });

    if (!params.streamStdin) {
      child.stdin.end();
    }

    if (!params.disableTimeout) {
      timeout = setTimeout(() => {
        timedOut = true;
        if (session) session.timedOut = true;
        terminateAppServerCommandExecSession(session ?? {
          child,
          processId: '',
          streamStdin: false,
          stdinClosed: true,
          timedOut: true,
        });
      }, params.timeoutMs ?? APP_SERVER_COMMAND_EXEC_DEFAULT_TIMEOUT_MS);
      timeout.unref();
    }
  });
}

function appServerCommandExecParams(rawParams: unknown): AppServerCommandExecParams {
  const input = recordInput(rawParams);
  const command = requiredArray(input.command, 'command').map((value, index) => {
    if (typeof value !== 'string') throw new AppServerRpcError(-32602, `command[${index}] must be a string`);
    return value;
  });
  const outputBytesCap = optionalNonNegativeInteger(input.outputBytesCap ?? input.output_bytes_cap, 'outputBytesCap');
  const timeoutMs = optionalNonNegativeInteger(input.timeoutMs ?? input.timeout_ms, 'timeoutMs');
  return {
    command,
    processId: optionalRawString(input.processId ?? input.process_id, 'processId'),
    tty: input.tty === true,
    streamStdin: input.streamStdin === true || input.stream_stdin === true,
    streamStdoutStderr: input.streamStdoutStderr === true || input.stream_stdout_stderr === true,
    outputBytesCap,
    disableOutputCap: input.disableOutputCap === true || input.disable_output_cap === true,
    disableTimeout: input.disableTimeout === true || input.disable_timeout === true,
    timeoutMs,
    cwd: optionalRawString(input.cwd, 'cwd'),
    env: optionalAppServerCommandEnv(input.env),
    size: input.size,
    sandboxPolicy: nullableOptional(input.sandboxPolicy ?? input.sandbox_policy),
    permissionProfile: nullableOptional(input.permissionProfile ?? input.permission_profile),
  };
}

function createAppServerOutputBuffer(params: AppServerCommandExecParams): AppServerCommandExecOutputBuffer {
  return {
    chunks: [],
    capturedBytes: 0,
    capBytes: params.disableOutputCap ? null : params.outputBytesCap ?? APP_SERVER_COMMAND_EXEC_DEFAULT_OUTPUT_BYTES_CAP,
  };
}

function appendAppServerOutputBuffer(target: AppServerCommandExecOutputBuffer, chunk: Buffer): void {
  if (target.capBytes !== null && target.capturedBytes >= target.capBytes) return;
  const remaining = target.capBytes === null ? chunk.byteLength : Math.max(0, target.capBytes - target.capturedBytes);
  const slice = remaining >= chunk.byteLength ? chunk : chunk.subarray(0, remaining);
  if (!slice.byteLength) return;
  target.chunks.push(slice);
  target.capturedBytes += slice.byteLength;
}

function appServerCommandExecEnv(overrides: Record<string, string | null> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!overrides) return env;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

function optionalAppServerCommandEnv(value: unknown): Record<string, string | null> | undefined {
  const normalized = nullableOptional(value);
  if (normalized === undefined) return undefined;
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new AppServerRpcError(-32602, 'env must be an object');
  }
  const env: Record<string, string | null> = {};
  for (const [key, rawValue] of Object.entries(normalized)) {
    if (typeof rawValue === 'string' || rawValue === null) {
      env[key] = rawValue;
      continue;
    }
    throw new AppServerRpcError(-32602, `env.${key} must be a string or null`);
  }
  return env;
}

function optionalRawString(value: unknown, name: string): string | undefined {
  const normalized = nullableOptional(value);
  if (normalized === undefined) return undefined;
  if (typeof normalized === 'string') return normalized;
  throw new AppServerRpcError(-32602, `${name} must be a string`);
}

function optionalNonNegativeInteger(value: unknown, name: string): number | undefined {
  const normalized = nullableOptional(value);
  if (normalized === undefined) return undefined;
  const numeric = numericInput(normalized);
  if (numeric === undefined || !Number.isInteger(numeric)) {
    throw new AppServerRpcError(-32602, `${name} must be an integer`);
  }
  if (numeric < 0) {
    const upstreamName = name === 'timeoutMs' ? 'timeoutMs' : name;
    throw new AppServerRpcError(-32602, `command/exec ${upstreamName} must be non-negative, got ${numeric}`);
  }
  return numeric;
}

function nullableOptional(value: unknown): unknown | undefined {
  return value === undefined || value === null ? undefined : value;
}

function strictBase64Decode(value: unknown, name: string): Buffer {
  if (typeof value !== 'string') throw new AppServerRpcError(-32602, `${name} must be a base64 string`);
  const normalized = value.trim();
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw new AppServerRpcError(-32602, `invalid ${name}`);
  }
  return decoded;
}

function requireAppServerCommandExecSession(
  sessions: Map<string, AppServerCommandExecSession>,
  processId: string,
): AppServerCommandExecSession {
  const session = sessions.get(processId);
  if (!session) throw new AppServerRpcError(-32600, `no active command/exec for process id ${JSON.stringify(processId)}`);
  return session;
}

function terminateAppServerCommandExecSession(session: AppServerCommandExecSession): void {
  if (session.child.killed) return;
  session.child.kill();
}

async function handleAppServerRpcRequest(
  runtime: RuntimeFactory,
  request: unknown,
  options: RuntimeServerOptions,
  commandExecManager: AppServerCommandExecManager,
): Promise<AppServerRpcResponse | null> {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return appServerRpcError(null, -32600, 'Invalid Request');
  }
  const rawId = (request as { id?: unknown }).id;
  if (rawId !== undefined && rawId !== null && typeof rawId !== 'string' && typeof rawId !== 'number') {
    return appServerRpcError(null, -32600, 'Invalid Request');
  }
  const message = request as AppServerRpcRequest;
  const id = rawId ?? null;
  if (typeof message.method !== 'string') {
    if (message.id !== undefined && ('result' in message || 'error' in message)) {
      return await handleAppServerRpcResponseEnvelope(runtime, message);
    }
    return appServerRpcError(id, -32600, 'Invalid Request');
  }
  if (message.id === undefined) {
    if (message.method === 'initialized') return null;
    return null;
  }

  try {
    const result = await dispatchAppServerRpcRequest(runtime, message.method, message.params, options, commandExecManager);
    return { id, result };
  } catch (error) {
    if (error instanceof AppServerRpcError) return appServerRpcError(id, error.code, error.message, error.data);
    return appServerRpcError(id, -32603, error instanceof Error ? error.message : String(error));
  }
}

async function handleAppServerRpcResponseEnvelope(
  runtime: RuntimeFactory,
  request: AppServerRpcRequest,
): Promise<AppServerRpcResponse | null> {
  const approvalId = typeof request.id === 'string' ? request.id : String(request.id ?? '');
  if (!approvalId) return appServerRpcError(null, -32600, 'Invalid Request');
  try {
    const answer = appServerApprovalAnswerFromResponse(request);
    await runtime.approvalGate.answerApproval(approvalId, answer);
    return null;
  } catch (error) {
    if (error instanceof AppServerRpcError) return appServerRpcError(request.id ?? null, error.code, error.message, error.data);
    return appServerRpcError(request.id ?? null, -32603, error instanceof Error ? error.message : String(error));
  }
}

async function dispatchAppServerRpcRequest(
  runtime: RuntimeFactory,
  method: string,
  params: unknown,
  options: RuntimeServerOptions,
  commandExecManager: AppServerCommandExecManager,
): Promise<unknown> {
  if (method === 'initialize') {
    return {
      userAgent: `setsuna-desktop/${options.version}`,
      appHome: path.resolve(options.dataDir),
      platformFamily: process.platform === 'win32' ? 'windows' : 'unix',
      platformOs: platformOs(),
    };
  }

  if (method === 'config/read') {
    const input = recordInput(params);
    const config = await runtime.configStore.getConfig();
    return appServerConfigReadResponse(config, input);
  }

  if (method === 'configRequirements/read') {
    return { requirements: null };
  }

  if (method === 'config/value/write') {
    const input = recordInput(params);
    const config = await runtime.configStore.getConfig();
    sweValidateConfigWriteTarget(config, input.filePath ?? input.file_path, input.expectedVersion ?? input.expected_version);
    const edit = appServerConfigEdit(input);
    const saved = await runtime.configStore.saveConfig(appServerRuntimeConfigInputFromEdits(config, [edit]));
    return appServerConfigWriteResponse(saved);
  }

  if (method === 'config/batchWrite') {
    const input = recordInput(params);
    const config = await runtime.configStore.getConfig();
    sweValidateConfigWriteTarget(config, input.filePath ?? input.file_path, input.expectedVersion ?? input.expected_version);
    const edits = requiredArray(input.edits, 'edits').map((edit, index) => appServerConfigEdit(recordInput(edit), index));
    const saved = await runtime.configStore.saveConfig(appServerRuntimeConfigInputFromEdits(config, edits));
    return appServerConfigWriteResponse(saved);
  }

  if (method === 'experimentalFeature/list') {
    const input = recordInput(params);
    const threadId = stringInput(input.threadId) || stringInput(input.thread_id);
    if (threadId) {
      const thread = await runtime.threadStore.getThread(threadId);
      if (!thread) throw new AppServerRpcError(-32600, `thread not found: ${threadId}`);
    }
    const config = await runtime.configStore.getConfig();
    return sweExperimentalFeatureListResponse(config, input);
  }

  if (method === 'experimentalFeature/enablement/set') {
    const config = await runtime.configStore.getConfig();
    const input = recordInput(params);
    const requested = recordInput(input.enablement);
    const enablement = sweSupportedFeatureEnablement(requested);
    if (Object.keys(enablement).length) {
      await runtime.configStore.saveConfig(sweFeatureEnablementRuntimeInput(config, enablement));
    }
    return { enablement };
  }

  if (method === 'collaborationMode/list') {
    return sweCollaborationModeListResponse();
  }

  if (method === 'model/list') {
    const input = recordInput(params);
    const config = await runtime.configStore.getConfig();
    return sweModelListResponse(config, input);
  }

  if (method === 'modelProvider/capabilities/read') {
    const config = await runtime.configStore.getConfig();
    return sweModelProviderCapabilitiesResponse(config);
  }

  if (method === 'permissionProfile/list') {
    return swePermissionProfileListResponse(recordInput(params));
  }

  if (method === 'mcpServerStatus/list') {
    return sweMcpServerStatusListResponse(await runtime.mcpStore.listServers(), recordInput(params));
  }

  if (method === 'command/exec') {
    return await commandExecManager.exec(params);
  }

  if (method === 'command/exec/write') {
    return commandExecManager.write(params);
  }

  if (method === 'command/exec/terminate') {
    return commandExecManager.terminate(params);
  }

  if (method === 'command/exec/resize') {
    return commandExecManager.resize(params);
  }

  if (method === 'thread/start') {
    const input = recordInput(params);
    const cwd = stringInput(input.cwd) || process.cwd();
    const thread = await runtime.threadStore.createThread({
      title: stringInput(input.name) || stringInput(input.threadName) || path.basename(cwd) || 'New thread',
      projectId: stringInput(input.projectId),
    });
    const config = await runtime.configStore.getConfig();
    return sweThreadSessionResponse(thread, cwd, config, options);
  }

  if (method === 'thread/resume') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const thread = await runtime.threadStore.getThread(threadId);
    if (!thread) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
    const config = await runtime.configStore.getConfig();
    const response = sweThreadSessionResponse(thread, process.cwd(), config, options, input.excludeTurns !== true);
    const initialTurnsPage = sweInitialTurnsPage(thread, input.initialTurnsPage);
    return initialTurnsPage ? { ...response, initialTurnsPage } : response;
  }

  if (method === 'thread/fork') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const source = await runtime.threadStore.getThread(threadId);
    if (!source) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
    const messages = runtimeMessagesThroughTurn(source.messages, stringInput(input.lastTurnId));
    const cwd = stringInput(input.cwd) || process.cwd();
    const thread = await runtime.threadStore.createThread({
      title: stringInput(input.name) || source.title,
      projectId: source.projectId,
      forkedFromId: source.id,
    });
    await copyRuntimeMessagesToThread(runtime, thread.id, messages);
    const forked = await runtime.threadStore.getThread(thread.id) ?? thread;
    const config = await runtime.configStore.getConfig();
    return sweThreadSessionResponse(forked, cwd, config, options, input.excludeTurns !== true);
  }

  if (method === 'thread/read') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const thread = await runtime.threadStore.getThread(threadId);
    if (!thread) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
    return { thread: sweThreadFromRuntimeThread(thread, process.cwd(), options, Boolean(input.includeTurns)) };
  }

  if (method === 'thread/turns/list') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const thread = await runtime.threadStore.getThread(threadId);
    if (!thread) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
    return sweThreadTurnsListResponse(thread, input);
  }

  if (method === 'thread/items/list') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId ?? input.thread_id, 'threadId');
    const thread = await runtime.threadStore.getThread(threadId);
    if (!thread) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
    return sweThreadItemsListResponse(thread, input);
  }

  if (method === 'thread/inject_items') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    await requireRuntimeThread(runtime, threadId);
    const messages = sweInjectedResponseItemsToRuntimeMessages(requiredArray(input.items, 'items'));
    for (const message of messages) {
      await appendAndPublishRuntimeEvent(runtime, threadId, {
        id: randomRuntimeId('event_inject'),
        threadId,
        type: 'message.created',
        createdAt: message.createdAt,
        payload: { message },
      });
    }
    return {};
  }

  if (method === 'thread/list') {
    const input = recordInput(params);
    const query: ThreadQuery = {
      includeArchived: input.archived === true,
      search: stringInput(input.searchTerm),
    };
    const threads = await runtime.threadStore.listThreads(query);
    return {
      data: threads.map((thread) => sweThreadFromRuntimeSummary(thread, process.cwd(), options)),
      nextCursor: null,
      backwardsCursor: threads.length ? null : null,
    };
  }

  if (method === 'thread/loaded/list') {
    const input = recordInput(params);
    const threads = await runtime.threadStore.listThreads({ includeArchived: true });
    return sweLoadedThreadListResponse(
      threads.map((thread) => thread.id),
      stringInput(input.cursor),
      numericInput(input.limit),
    );
  }

  if (method === 'thread/name/set') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const name = requiredString(input.name, 'name');
    await requireRuntimeThread(runtime, threadId);
    await runtime.threadStore.updateThread(threadId, { title: name });
    return {};
  }

  if (method === 'thread/goal/set') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const thread = await requireRuntimeThread(runtime, threadId);
    const goal = sweSetThreadGoal(thread, input);
    await appendAndPublishRuntimeEvent(runtime, threadId, {
      id: randomRuntimeId('event_goal'),
      threadId,
      type: 'thread.goal_updated',
      createdAt: new Date(goal.updatedAt * 1000).toISOString(),
      payload: { goal },
    });
    return { goal };
  }

  if (method === 'thread/goal/get') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const thread = await requireRuntimeThread(runtime, threadId);
    return { goal: thread.goal ? { ...thread.goal } : null };
  }

  if (method === 'thread/goal/clear') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const thread = await requireRuntimeThread(runtime, threadId);
    const cleared = Boolean(thread.goal);
    if (!cleared) return { cleared };
    await appendAndPublishRuntimeEvent(runtime, threadId, {
      id: randomRuntimeId('event_goal'),
      threadId,
      type: 'thread.goal_cleared',
      createdAt: new Date().toISOString(),
      payload: { cleared },
    });
    return { cleared };
  }

  if (method === 'thread/metadata/update') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const thread = await requireRuntimeThread(runtime, threadId);
    const gitInfo = swePatchThreadGitInfo(thread, input);
    await appendAndPublishRuntimeEvent(runtime, threadId, {
      id: randomRuntimeId('event_metadata'),
      threadId,
      type: 'thread.metadata_updated',
      createdAt: new Date().toISOString(),
      payload: { gitInfo },
    });
    const updated = await runtime.threadStore.getThread(threadId);
    return {
      thread: sweThreadFromRuntimeThread(updated ?? thread, process.cwd(), options),
    };
  }

  if (method === 'thread/archive') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    await requireRuntimeThread(runtime, threadId);
    await runtime.threadStore.updateThread(threadId, { archived: true });
    return {};
  }

  if (method === 'thread/delete') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const thread = await requireRuntimeThread(runtime, threadId);
    const activeTurnId = runtime.agentLoop.activeTurnId(threadId);
    if (activeTurnId) await runtime.agentLoop.cancelTurn(threadId, activeTurnId);
    runtime.eventBus.publish({
      id: randomRuntimeId('event_deleted'),
      seq: thread.lastSeq + 1,
      threadId,
      type: 'thread.deleted',
      createdAt: new Date().toISOString(),
      payload: {},
    });
    await runtime.threadStore.deleteThread(threadId);
    return {};
  }

  if (method === 'thread/unarchive') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    await requireRuntimeThread(runtime, threadId);
    const thread = await runtime.threadStore.updateThread(threadId, { archived: false });
    return { thread: sweThreadFromRuntimeThread(thread, process.cwd(), options) };
  }

  if (method === 'thread/compact/start') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const thread = await runtime.threadStore.getThread(threadId);
    if (!thread) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
    void runtime.agentLoop.compactThreadContext(threadId, true).catch(() => undefined);
    return {};
  }

  if (method === 'thread/unsubscribe') {
    return { status: 'notLoaded' };
  }

  if (method === 'thread/shellCommand') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const command = requiredString(input.command, 'command');
    const thread = await runtime.threadStore.getThread(threadId);
    if (!thread) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
    void runAppServerThreadShellCommand(runtime, thread, command, runtime.agentLoop.activeTurnId(threadId)).catch(() => undefined);
    return {};
  }

  if (method === 'thread/rollback') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const numTurns = requiredPositiveInteger(input.numTurns, 'numTurns');
    const thread = await runtime.threadStore.getThread(threadId);
    if (!thread) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
    const rollbackMessageId = rollbackStartMessageId(thread.messages, numTurns);
    const rolledBack = rollbackMessageId
      ? await runtime.threadStore.truncateMessagesAfter(threadId, rollbackMessageId, true)
      : thread;
    return { thread: sweThreadFromRuntimeThread(rolledBack, process.cwd(), options, true) };
  }

  if (method === 'review/start') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId ?? input.thread_id, 'threadId');
    const delivery = stringInput(input.delivery) ?? 'inline';
    if (delivery !== 'inline') throw new AppServerRpcError(-32600, 'review/start detached delivery is not supported yet');
    const review = sweReviewRequestFromTarget(input.target);
    try {
      const started = await runtime.agentLoop.startReview(threadId, review);
      return {
        turn: sweTurn(started.turnId, 'inProgress', {
          items: [sweReviewUserMessageItem(started.turnId, review.displayText)],
          itemsView: 'notLoaded',
        }),
        reviewThreadId: threadId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Thread not found:')) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
      throw new AppServerRpcError(-32600, message);
    }
  }

  if (method === 'turn/start') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const text = sweUserInputText(input.input);
    const started = await runtime.agentLoop.startTurn(threadId, {
      input: text,
      clientId: sweClientUserMessageId(input),
    });
    return { turn: sweTurn(started.turnId, 'inProgress') };
  }

  if (method === 'turn/steer') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId ?? input.thread_id, 'threadId');
    const expectedTurnId = requiredString(input.expectedTurnId ?? input.expected_turn_id, 'expectedTurnId');
    const text = sweUserInputText(input.input);
    if (!text.trim()) throw new AppServerRpcError(-32600, 'input must not be empty');
    try {
      const steered = await runtime.agentLoop.steerTurn(threadId, {
        input: text,
        clientId: sweClientUserMessageId(input),
        expectedTurnId,
      });
      return { turnId: steered.turnId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Thread not found:')) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
      throw new AppServerRpcError(-32600, message);
    }
  }

  if (method === 'turn/interrupt') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId, 'threadId');
    const turnId = requiredString(input.turnId, 'turnId');
    await cancelRuntimeTurn(runtime, threadId, turnId);
    return {};
  }

  throw new AppServerRpcError(-32601, `Method not found: ${method}`);
}

async function handleSse({
  format,
  response,
  threadId,
  sinceSeq,
  runtime,
}: {
  format: RuntimeEventStreamFormat;
  response: ServerResponse;
  threadId: string;
  sinceSeq: number;
  runtime: ReturnType<typeof createRuntimeFactory>;
}): Promise<void> {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sweMapEvent = format === 'swe' ? createSweNotificationMapper() : null;
  const existing = await runtime.threadStore.listEvents(threadId, format === 'swe' ? 0 : sinceSeq);
  for (const event of existing) {
    if (format === 'swe' && sweMapEvent) {
      const notifications = sweMapEvent(event);
      if (event.seq > sinceSeq) writeSweSse(response, notifications);
    } else {
      writeRuntimeSse(response, event);
    }
  }

  const unsubscribe = runtime.eventBus.subscribe(threadId, (event) => {
    if (format === 'swe' && sweMapEvent) {
      writeSweSse(response, sweMapEvent(event));
      return;
    }
    writeRuntimeSse(response, event);
  });
  response.on('close', unsubscribe);
}

async function publishThreadEventsSince(
  runtime: ReturnType<typeof createRuntimeFactory>,
  threadId: string,
  sinceSeq: number,
): Promise<void> {
  const events = await runtime.threadStore.listEvents(threadId, sinceSeq);
  for (const event of events) runtime.eventBus.publish(event);
}

type RuntimeEventStreamFormat = 'runtime' | 'swe';

function runtimeEventStreamFormat(value: string | null): RuntimeEventStreamFormat {
  return value === 'swe' ? 'swe' : 'runtime';
}

function writeRuntimeSse(response: ServerResponse, event: RuntimeEvent): void {
  response.write('event: runtime-event\n');
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeSweSse(response: ServerResponse, notifications: SweNotification[]): void {
  for (const notification of notifications) {
    response.write('event: swe-notification\n');
    response.write(`data: ${JSON.stringify(notification)}\n\n`);
  }
}

class AppServerRpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
  }
}

function appServerRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): AppServerRpcResponse {
  return data === undefined ? { id, error: { code, message } } : { id, error: { code, message, data } };
}

async function requireRuntimeThread(runtime: RuntimeFactory, threadId: string): Promise<RuntimeThread> {
  const thread = await runtime.threadStore.getThread(threadId);
  if (!thread) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
  return thread;
}

async function settleStaleRuntimeTurns(runtime: RuntimeFactory): Promise<void> {
  const summaries = await runtime.threadStore.listThreads({ includeArchived: true });
  for (const summary of summaries) {
    const thread = await runtime.threadStore.getThread(summary.id);
    if (!thread) continue;
    for (const turnId of activeTurnIdsInThread(thread)) {
      await appendAndPublishRuntimeEvent(runtime, thread.id, {
        id: randomRuntimeId('event_cancel'),
        threadId: thread.id,
        turnId,
        type: 'turn.cancelled',
        createdAt: new Date().toISOString(),
        payload: { reason: 'Turn cancelled because the desktop runtime restarted.' },
      });
    }
  }
}

async function cancelRuntimeTurn(runtime: RuntimeFactory, threadId: string, turnId: string): Promise<boolean> {
  const cancelled = await runtime.agentLoop.cancelTurn(threadId, turnId);
  if (cancelled) return true;
  const thread = await runtime.threadStore.getThread(threadId);
  if (!thread || !runtimeTurnAppearsActive(thread, turnId)) return false;
  await appendAndPublishRuntimeEvent(runtime, threadId, {
    id: randomRuntimeId('event_cancel'),
    threadId,
    turnId,
    type: 'turn.cancelled',
    createdAt: new Date().toISOString(),
    payload: { reason: 'Turn cancelled.' },
  });
  return true;
}

function activeTurnIdsInThread(thread: RuntimeThread): string[] {
  const turnIds = new Set<string>();
  for (const message of thread.messages) {
    if (!message.turnId) continue;
    if (message.status === 'streaming' || message.toolRuns?.some(isActiveRuntimeToolRun)) {
      turnIds.add(message.turnId);
    }
  }
  return [...turnIds];
}

function runtimeTurnAppearsActive(thread: RuntimeThread, turnId: string): boolean {
  return activeTurnIdsInThread(thread).includes(turnId);
}

function isActiveRuntimeToolRun(run: NonNullable<RuntimeMessage['toolRuns']>[number]): boolean {
  return run.status === 'running' || (run.status === 'pending_approval' && run.approvalStatus !== 'approved' && run.approvalStatus !== 'rejected');
}

async function runAppServerThreadShellCommand(
  runtime: RuntimeFactory,
  thread: RuntimeThread,
  command: string,
  activeTurnId: string | null = null,
): Promise<void> {
  const turnId = activeTurnId ?? randomRuntimeId('turn_shell');
  const toolCallId = randomRuntimeId('call_shell');
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const argumentsPreview = JSON.stringify({ command, risk_level: 'low', yield_time_ms: 0 });
  const deltaPublishes: Promise<void>[] = [];
  const standaloneTurn = !activeTurnId;
  const holderMessageId = threadHasAssistantForTurn(thread, turnId) ? null : randomRuntimeId('msg_shell');

  if (standaloneTurn) {
    await appendAndPublishRuntimeEvent(runtime, thread.id, {
      id: randomRuntimeId('event'),
      threadId: thread.id,
      turnId,
      type: 'turn.started',
      createdAt: startedAt,
      payload: { input: command },
    });
  }
  if (holderMessageId) {
    await appendAndPublishRuntimeEvent(runtime, thread.id, {
      id: randomRuntimeId('event'),
      threadId: thread.id,
      turnId,
      type: 'message.created',
      createdAt: startedAt,
      payload: {
        message: {
          id: holderMessageId,
          turnId,
          role: 'assistant',
          content: '',
          createdAt: startedAt,
          status: 'streaming',
        },
      },
    });
  }
  await appendAndPublishRuntimeEvent(runtime, thread.id, {
    id: randomRuntimeId('event'),
    threadId: thread.id,
    turnId,
    type: 'tool.started',
    createdAt: startedAt,
    payload: {
      toolCallId,
      toolName: 'run_shell_command',
      source: 'userShell',
      argumentsPreview,
    },
  });

  let status: 'success' | 'error' = 'success';
  let content = '';
  let data: unknown;
  try {
    const result = await runtime.toolHost.runTool('run_shell_command', {
      command,
      risk_level: 'low',
      yield_time_ms: 0,
    }, {
      threadId: thread.id,
      projectId: thread.projectId,
      turnId,
      toolCallId,
      permissionProfile: 'danger-full-access',
      onToolOutputDelta: (delta) => {
        const publish = appendAndPublishRuntimeEvent(runtime, thread.id, {
          id: randomRuntimeId('event'),
          threadId: thread.id,
          turnId,
          type: 'tool.output_delta',
          createdAt: new Date().toISOString(),
          payload: {
            toolCallId,
            toolName: 'run_shell_command',
            source: 'userShell',
            delta: delta.delta,
            stream: delta.stream,
            processId: delta.processId,
          },
        }).then(() => undefined, () => undefined);
        deltaPublishes.push(publish);
      },
    });
    content = result.content;
    data = result.data;
  } catch (error) {
    status = 'error';
    content = error instanceof Error ? error.message : String(error);
  }

  await Promise.all(deltaPublishes);
  const completedAt = new Date();
  await appendAndPublishRuntimeEvent(runtime, thread.id, {
    id: randomRuntimeId('event'),
    threadId: thread.id,
    turnId,
    type: 'tool.completed',
    createdAt: completedAt.toISOString(),
    payload: {
      toolCallId,
      toolName: 'run_shell_command',
      source: 'userShell',
      status,
      content,
      argumentsPreview,
      data,
      durationMs: Math.max(0, completedAt.getTime() - startedAtMs),
    },
  });
  if (holderMessageId) {
    await appendAndPublishRuntimeEvent(runtime, thread.id, {
      id: randomRuntimeId('event'),
      threadId: thread.id,
      turnId,
      type: 'message.completed',
      createdAt: completedAt.toISOString(),
      payload: { messageId: holderMessageId },
    });
  }
  if (activeTurnId) {
    await appendAndPublishRuntimeEvent(runtime, thread.id, {
      id: randomRuntimeId('event'),
      threadId: thread.id,
      turnId,
      type: 'message.created',
      createdAt: new Date().toISOString(),
      payload: {
        message: {
          id: randomRuntimeId('msg_shell'),
          turnId,
          role: 'tool',
          toolCallId,
          toolName: 'run_shell_command',
          content,
          createdAt: new Date().toISOString(),
          status: 'complete',
        },
      },
    });
  }
  if (standaloneTurn) {
    await appendAndPublishRuntimeEvent(runtime, thread.id, {
      id: randomRuntimeId('event'),
      threadId: thread.id,
      turnId,
      type: 'turn.completed',
      createdAt: new Date().toISOString(),
      payload: {},
    });
  }
}

function threadHasAssistantForTurn(thread: RuntimeThread, turnId: string): boolean {
  return thread.messages.some((message) => message.turnId === turnId && message.role === 'assistant');
}

async function appendAndPublishRuntimeEvent(
  runtime: RuntimeFactory,
  threadId: string,
  event: Omit<RuntimeEvent, 'seq'>,
): Promise<RuntimeEvent> {
  const saved = await runtime.threadStore.appendEvent(threadId, event);
  runtime.eventBus.publish(saved);
  return saved;
}

function randomRuntimeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

async function copyRuntimeMessagesToThread(
  runtime: RuntimeFactory,
  threadId: string,
  messages: RuntimeMessage[],
): Promise<void> {
  let index = 0;
  for (const message of messages) {
    index += 1;
    const createdAt = new Date().toISOString();
    await runtime.threadStore.appendEvent(threadId, {
      id: `event_fork_${message.id}_${index}`,
      threadId,
      turnId: message.turnId,
      type: 'message.created',
      createdAt,
      payload: { message: cloneRuntimeMessage(message) },
    });
  }
}

function runtimeMessagesThroughTurn(messages: RuntimeMessage[], lastTurnId: string | undefined): RuntimeMessage[] {
  if (!lastTurnId) return messages;
  const order = runtimeTurnOrder(messages);
  const cutoff = order.get(lastTurnId);
  if (!cutoff) throw new AppServerRpcError(-32602, `Unknown lastTurnId: ${lastTurnId}`);
  return messages.filter((message) => {
    if (message.turnId) return (order.get(message.turnId)?.order ?? Number.POSITIVE_INFINITY) <= cutoff.order;
    const createdAtMs = parseDateMs(message.createdAt);
    return createdAtMs !== null && compareNullableMs(createdAtMs, cutoff.endMs) <= 0;
  });
}

function rollbackStartMessageId(messages: RuntimeMessage[], numTurns: number): string | null {
  const order = runtimeTurnOrder(messages);
  if (!order.size) return null;
  const firstDroppedOrder = Math.max(0, order.size - numTurns);
  const firstDropped = [...order.entries()].find(([, turn]) => turn.order === firstDroppedOrder);
  if (!firstDropped) return null;
  const [turnId] = firstDropped;
  return messages.find((message) => message.turnId === turnId)?.id ?? null;
}

function runtimeTurnOrder(messages: RuntimeMessage[]): Map<string, { endMs: number | null; order: number }> {
  const turns = new Map<string, { endMs: number | null; firstIndex: number; startMs: number | null; turnId: string }>();
  for (const [index, message] of messages.entries()) {
    if (!message.turnId) continue;
    const createdAtMs = parseDateMs(message.createdAt);
    const existing = turns.get(message.turnId);
    if (!existing) {
      turns.set(message.turnId, {
        endMs: createdAtMs,
        firstIndex: index,
        startMs: createdAtMs,
        turnId: message.turnId,
      });
      continue;
    }
    existing.firstIndex = Math.min(existing.firstIndex, index);
    existing.startMs = minNullableMs(existing.startMs, createdAtMs);
    existing.endMs = maxNullableMs(existing.endMs, createdAtMs);
  }

  return new Map(
    [...turns.values()]
      .sort((left, right) => compareNullableMs(left.startMs, right.startMs) || left.firstIndex - right.firstIndex)
      .map((turn, index) => [turn.turnId, { endMs: turn.endMs, order: index }]),
  );
}

function cloneRuntimeMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    contextCompaction: message.contextCompaction ? { ...message.contextCompaction } : undefined,
    reviewMode: message.reviewMode ? { ...message.reviewMode } : undefined,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    toolRuns: message.toolRuns?.map((toolRun) => ({ ...toolRun })),
  };
}

function sweThreadFromRuntimeSummary(
  thread: RuntimeThread | Pick<RuntimeThread, 'id' | 'forkedFromId' | 'title' | 'createdAt' | 'updatedAt' | 'lastMessagePreview' | 'archived' | 'gitInfo'>,
  cwd: string,
  options: RuntimeServerOptions,
) {
  const createdAt = toUnixSeconds(thread.createdAt);
  const updatedAt = toUnixSeconds(thread.updatedAt);
  return {
    id: thread.id,
    sessionId: thread.id,
    forkedFromId: thread.forkedFromId ?? null,
    parentThreadId: null,
    preview: thread.lastMessagePreview,
    ephemeral: false,
    modelProvider: 'setsuna',
    createdAt,
    updatedAt,
    recencyAt: updatedAt,
    status: { type: 'notLoaded' },
    path: null,
    cwd,
    cliVersion: options.version,
    source: 'appServer',
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: thread.gitInfo ? { ...thread.gitInfo } : null,
    name: thread.title,
    turns: [],
  };
}

function sweThreadFromRuntimeThread(thread: RuntimeThread, cwd: string, options: RuntimeServerOptions, includeTurns = false) {
  return {
    ...sweThreadFromRuntimeSummary(thread, cwd, options),
    status: { type: 'idle' },
    turns: includeTurns ? runtimeThreadToSweTurns(thread) : [],
  };
}

function sweThreadSessionResponse(
  thread: RuntimeThread,
  cwd: string,
  config: Awaited<ReturnType<RuntimeFactory['configStore']['getConfig']>>,
  options: RuntimeServerOptions,
  includeTurns = false,
) {
  return {
    thread: sweThreadFromRuntimeThread(thread, cwd, options, includeTurns),
    model: activeModelCode(config),
    modelProvider: activeModelProvider(config),
    serviceTier: null,
    cwd,
    instructionSources: [],
    approvalPolicy: appServerApprovalPolicy(config.approvalPolicy),
    approvalsReviewer: 'user',
    sandbox: sweSandboxPolicy(config.permissionProfile, cwd),
    reasoningEffort: null,
  };
}

type AppServerSortDirection = 'asc' | 'desc';
type AppServerTurnItemsView = SweTurn['itemsView'];
type AppServerThreadItem = SweTurn['items'][number];

type AppServerThreadTurnsCursor = {
  turnId: string;
  includeAnchor: boolean;
};

type AppServerThreadItemsCursor = {
  turnId: string;
  itemId: string;
  includeAnchor: boolean;
};

type AppServerThreadItemEntry = {
  index: number;
  item: AppServerThreadItem;
  turnId: string;
};

type AppServerModelCatalogItem = {
  id: string;
  model: string;
  upgrade: string | null;
  upgradeInfo: null;
  availabilityNux: null;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort: string;
  inputModalities: string[];
  supportsPersonality: boolean;
  additionalSpeedTiers: string[];
  serviceTiers: Array<{ id: string; name: string; description: string }>;
  defaultServiceTier: string | null;
  isDefault: boolean;
};

type AppServerPermissionProfileSummary = {
  id: string;
  description: string | null;
  allowed: boolean;
};

type AppServerExperimentalFeatureStage = 'beta' | 'underDevelopment' | 'stable' | 'deprecated' | 'removed';

type AppServerExperimentalFeatureSpec = {
  name: string;
  stage: AppServerExperimentalFeatureStage;
  displayName: string | null;
  description: string | null;
  announcement: string | null;
  defaultEnabled: boolean;
  forceDisabled?: boolean;
};

type AppServerConfigLayerSource = {
  type: 'user';
  file: string;
  profile: string | null;
};

type AppServerConfigLayerMetadata = {
  name: AppServerConfigLayerSource;
  version: string;
};

type AppServerConfigEdit = {
  keyPath: string;
  value: unknown;
  mergeStrategy: 'replace' | 'upsert';
};

const APP_SERVER_CONFIG_LAYER_VERSION = '1';

const APP_SERVER_CONFIG_ENABLEMENT_FEATURES = [
  'auth_elicitation',
  'memories',
  'mentions_v2',
  'remote_control',
  'remote_plugin',
  'tool_suggest',
] as const;

const APP_SERVER_EXPERIMENTAL_FEATURES: readonly AppServerExperimentalFeatureSpec[] = [
  { name: 'undo', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'shell_tool', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'secret_auth_storage', stage: 'stable', defaultEnabled: process.platform === 'win32', displayName: null, description: null, announcement: null },
  { name: 'unified_exec', stage: 'stable', defaultEnabled: process.platform !== 'win32', displayName: null, description: null, announcement: null },
  { name: 'shell_zsh_fork', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'unified_exec_zsh_fork', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'shell_snapshot', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'deferred_executor', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'js_repl', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'code_mode', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'code_mode_host', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'code_mode_only', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'js_repl_tools_only', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'terminal_resize_reflow', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'web_search_request', stage: 'deprecated', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'web_search_cached', stage: 'deprecated', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'standalone_web_search', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'search_tool', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'swe_git_commit', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'runtime_metrics', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'sqlite', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  {
    name: 'memories',
    stage: 'beta',
    defaultEnabled: false,
    displayName: 'Memories',
    description: 'Allow AppServer to create new memories from conversations and bring relevant memories into new conversations.',
    announcement: 'NEW: AppServer can now generate and use memories. Try it now with `/memories`',
  },
  { name: 'local_thread_store_compression', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'chronicle', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'apply_patch_freeform', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'apply_patch_streaming_events', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'exec_permission_approvals', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'hooks', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'request_permissions_tool', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'use_linux_sandbox_bwrap', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'use_legacy_landlock', stage: 'deprecated', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'request_rule', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'experimental_windows_sandbox', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'elevated_windows_sandbox', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'remote_models', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'enable_request_compression', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  {
    name: 'network_proxy',
    stage: 'beta',
    defaultEnabled: false,
    displayName: 'Network proxy',
    description: 'Apply network proxy restrictions to sandboxed sessions that already have network access.',
    announcement: 'NEW: Network proxy can now be enabled from /experimental. Restart AppServer after enabling it.',
  },
  { name: 'respect_system_proxy', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'multi_agent', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'multi_agent_v2', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'multi_agent_mode', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'enable_fanout', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'apps', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null, forceDisabled: true },
  { name: 'enable_mcp_apps', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'apps_mcp_path_override', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'tool_search', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'tool_search_always_defer_mcp_tools', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'non_prefixed_mcp_tool_names', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'unavailable_dummy_tools', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'tool_suggest', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'plugins', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null, forceDisabled: true },
  { name: 'plugin_hooks', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'in_app_browser', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'browser_use', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'browser_use_full_cdp_access', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'browser_use_external', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'computer_use', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'remote_plugin', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'plugin_sharing', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'external_migration', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'image_generation', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'imagegenext', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'resize_all_images', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'item_ids', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'skill_mcp_dependency_install', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'skill_env_var_dependency_prompt', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'mentions_v2', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'steer', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'default_mode_request_user_input', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'terminal_visualization_instructions', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'guardian_approval', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'goals', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'token_budget', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'rollout_budget', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'current_time_reminder', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'collaboration_modes', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'tool_call_mcp_elicitation', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'auth_elicitation', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'personality', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'artifact', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'fast_mode', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'realtime_conversation', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'remote_control', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'image_detail_original', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'tui_app_server', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  {
    name: 'prevent_idle_sleep',
    stage: 'beta',
    defaultEnabled: false,
    displayName: 'Prevent sleep while running',
    description: 'Keep your computer awake while AppServer is running a thread.',
    announcement: 'NEW: Prevent sleep while running is now available in /experimental.',
  },
  { name: 'workspace_owner_usage_nudge', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'responses_websockets', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'responses_websockets_v2', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'remote_compaction_v2', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'use_agent_identity', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'workspace_dependencies', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
];

function sweInitialTurnsPage(thread: RuntimeThread, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const page = sweThreadTurnsListResponse(thread, recordInput(value));
  return {
    data: page.data,
    nextCursor: page.nextCursor,
    backwardsCursor: page.backwardsCursor,
  };
}

function sweThreadTurnsListResponse(thread: RuntimeThread, input: Record<string, unknown>) {
  const turns = runtimeThreadToSweTurns(thread);
  const viewedTurns = sweTurnsWithItemsView(turns, sweTurnItemsView(input.itemsView));
  return sweTurnPage(
    viewedTurns,
    stringInput(input.cursor),
    numericInput(input.limit),
    sweSortDirection(input.sortDirection),
  );
}

function sweThreadItemsListResponse(thread: RuntimeThread, input: Record<string, unknown>) {
  const turnIdFilter = stringInput(input.turnId ?? input.turn_id);
  const entries = runtimeThreadToSweTurns(thread).flatMap((turn) => {
    if (turnIdFilter && turn.id !== turnIdFilter) return [];
    return turn.items.map((item, itemIndex) => ({
      index: itemIndex,
      item,
      turnId: turn.id,
    }));
  });
  return sweThreadItemPage(
    entries.map((entry, index) => ({ ...entry, index })),
    stringInput(input.cursor),
    numericInput(input.limit),
    sweSortDirection(input.sortDirection ?? input.sort_direction, 'asc'),
  );
}

function sweTurnPage(
  turns: SweTurn[],
  cursor: string | undefined,
  limit: number | undefined,
  sortDirection: AppServerSortDirection,
) {
  if (!turns.length) return { data: [], nextCursor: null, backwardsCursor: null };

  const anchor = cursor ? sweParseTurnCursor(cursor) : null;
  const anchorIndex = anchor ? turns.findIndex((turn) => turn.id === anchor.turnId) : -1;
  if (anchor && anchorIndex < 0) {
    throw new AppServerRpcError(-32600, 'invalid cursor: anchor turn is no longer present');
  }

  const pageSize = Math.min(100, Math.max(1, Math.trunc(limit ?? 25)));
  let keyedTurns = turns.map((turn, index) => ({ index, turn }));
  if (sortDirection === 'desc') keyedTurns = keyedTurns.reverse();

  if (anchor) {
    keyedTurns = keyedTurns.filter(({ index }) => {
      if (sortDirection === 'asc') return anchor.includeAnchor ? index >= anchorIndex : index > anchorIndex;
      return anchor.includeAnchor ? index <= anchorIndex : index < anchorIndex;
    });
  }

  const moreTurnsAvailable = keyedTurns.length > pageSize;
  const page = keyedTurns.slice(0, pageSize);
  return {
    data: page.map(({ turn }) => turn),
    nextCursor: moreTurnsAvailable ? sweSerializeTurnCursor(page.at(-1)?.turn.id, false) : null,
    backwardsCursor: page.length ? sweSerializeTurnCursor(page[0].turn.id, true) : null,
  };
}

function sweThreadItemPage(
  entries: AppServerThreadItemEntry[],
  cursor: string | undefined,
  limit: number | undefined,
  sortDirection: AppServerSortDirection,
) {
  if (!entries.length) return { data: [], nextCursor: null, backwardsCursor: null };

  const anchor = cursor ? sweParseItemCursor(cursor) : null;
  const anchorIndex = anchor ? entries.findIndex((entry) => entry.turnId === anchor.turnId && entry.item.id === anchor.itemId) : -1;
  if (anchor && anchorIndex < 0) {
    throw new AppServerRpcError(-32600, 'invalid cursor: anchor item is no longer present');
  }

  const pageSize = Math.min(100, Math.max(1, Math.trunc(limit ?? 25)));
  let keyedItems = [...entries];
  if (sortDirection === 'desc') keyedItems = keyedItems.reverse();

  if (anchor) {
    keyedItems = keyedItems.filter((entry) => {
      if (sortDirection === 'asc') return anchor.includeAnchor ? entry.index >= anchorIndex : entry.index > anchorIndex;
      return anchor.includeAnchor ? entry.index <= anchorIndex : entry.index < anchorIndex;
    });
  }

  const moreItemsAvailable = keyedItems.length > pageSize;
  const page = keyedItems.slice(0, pageSize);
  return {
    data: page.map((entry) => entry.item),
    nextCursor: moreItemsAvailable ? sweSerializeItemCursor(page.at(-1), false) : null,
    backwardsCursor: page.length ? sweSerializeItemCursor(page[0], true) : null,
  };
}

function sweTurnsWithItemsView(turns: SweTurn[], itemsView: AppServerTurnItemsView): SweTurn[] {
  return turns.map((turn) => {
    if (itemsView === 'full') return { ...turn, items: [...turn.items], itemsView };
    if (itemsView === 'notLoaded') return { ...turn, items: [], itemsView };
    return { ...turn, items: sweSummaryTurnItems(turn.items), itemsView };
  });
}

function sweSummaryTurnItems(items: AppServerThreadItem[]): AppServerThreadItem[] {
  const firstUserMessage = items.find((item) => item.type === 'userMessage');
  const finalAgentMessage = [...items].reverse().find((item) => item.type === 'agentMessage');
  if (firstUserMessage && finalAgentMessage && firstUserMessage.id !== finalAgentMessage.id) {
    return [firstUserMessage, finalAgentMessage];
  }
  if (firstUserMessage) return [firstUserMessage];
  if (finalAgentMessage) return [finalAgentMessage];
  return [];
}

function sweTurnItemsView(value: unknown): AppServerTurnItemsView {
  if (value === 'notLoaded' || value === 'summary' || value === 'full') return value;
  return 'summary';
}

function sweSortDirection(value: unknown, fallback: AppServerSortDirection = 'desc'): AppServerSortDirection {
  if (value === 'asc' || value === 'desc') return value;
  return fallback;
}

function sweSerializeTurnCursor(turnId: string | undefined, includeAnchor: boolean): string | null {
  return turnId ? JSON.stringify({ turnId, includeAnchor }) : null;
}

function sweSerializeItemCursor(entry: AppServerThreadItemEntry | undefined, includeAnchor: boolean): string | null {
  return entry ? JSON.stringify({ turnId: entry.turnId, itemId: entry.item.id, includeAnchor }) : null;
}

function sweParseTurnCursor(cursor: string): AppServerThreadTurnsCursor {
  try {
    const value = JSON.parse(cursor) as unknown;
    const record = recordInput(value);
    const turnId = stringInput(record.turnId);
    if (!turnId || typeof record.includeAnchor !== 'boolean') throw new Error('invalid cursor');
    return { turnId, includeAnchor: record.includeAnchor };
  } catch {
    throw new AppServerRpcError(-32600, `invalid cursor: ${cursor}`);
  }
}

function sweParseItemCursor(cursor: string): AppServerThreadItemsCursor {
  try {
    const value = JSON.parse(cursor) as unknown;
    const record = recordInput(value);
    const turnId = stringInput(record.turnId);
    const itemId = stringInput(record.itemId);
    if (!turnId || !itemId || typeof record.includeAnchor !== 'boolean') throw new Error('invalid cursor');
    return { turnId, itemId, includeAnchor: record.includeAnchor };
  } catch {
    throw new AppServerRpcError(-32600, `invalid cursor: ${cursor}`);
  }
}

function appServerConfigReadResponse(config: RuntimeConfigState, input: Record<string, unknown>) {
  const cwd = stringInput(input.cwd) || process.cwd();
  const configValue = sweEffectiveConfig(config, cwd);
  const metadata = appServerConfigLayerMetadata(config);
  const origins = appServerConfigOrigins(configValue, metadata);
  const includeLayers = input.includeLayers === true || input.include_layers === true;
  return {
    config: configValue,
    origins,
    ...(includeLayers
      ? {
          layers: [
            {
              name: metadata.name,
              version: metadata.version,
              config: configValue,
            },
          ],
        }
      : {}),
  };
}

function sweEffectiveConfig(config: RuntimeConfigState, cwd: string): Record<string, unknown> {
  const reasoningEffort = activeModelReasoningEffort(config);
  return {
    model: activeModelCode(config),
    review_model: null,
    model_context_window: null,
    model_auto_compact_token_limit: null,
    model_auto_compact_token_limit_scope: null,
    model_provider: activeModelProvider(config),
    approval_policy: appServerApprovalPolicy(config.approvalPolicy),
    approvals_reviewer: 'user',
    sandbox_mode: sweSandboxMode(config.permissionProfile),
    sandbox_workspace_write: sweSandboxWorkspaceWrite(config, cwd),
    forced_chatgpt_workspace_id: null,
    forced_login_method: null,
    web_search: null,
    tools: null,
    instructions: config.globalPrompt || null,
    developer_instructions: null,
    compact_prompt: null,
    model_reasoning_effort: reasoningEffort,
    model_reasoning_summary: null,
    model_verbosity: null,
    service_tier: null,
    analytics: null,
    apps: null,
    desktop: {
      ...(config.desktopSettings ?? {}),
      data_path: config.dataPath,
      storage_path: config.storagePath,
      setsuna_style: config.setsunaStyle,
      memory_enabled: config.memoryEnabled,
    },
    features: appServerConfigFeatureEnablement(config),
  };
}

function appServerConfigOrigins(
  configValue: Record<string, unknown>,
  metadata: AppServerConfigLayerMetadata,
): Record<string, AppServerConfigLayerMetadata> {
  const origins: Record<string, AppServerConfigLayerMetadata> = {};
  for (const key of Object.keys(configValue)) {
    origins[key] = metadata;
  }
  const sandbox = recordInput(configValue.sandbox_workspace_write);
  if (Array.isArray(sandbox.writable_roots)) {
    origins['sandbox_workspace_write.writable_roots'] = metadata;
    for (const index of sandbox.writable_roots.keys()) {
      origins[`sandbox_workspace_write.writable_roots.${index}`] = metadata;
    }
  }
  if (hasOwn(sandbox, 'network_access')) origins['sandbox_workspace_write.network_access'] = metadata;
  if (hasOwn(sandbox, 'exclude_tmpdir_env_var')) {
    origins['sandbox_workspace_write.exclude_tmpdir_env_var'] = metadata;
  }
  if (hasOwn(sandbox, 'exclude_slash_tmp')) origins['sandbox_workspace_write.exclude_slash_tmp'] = metadata;
  return origins;
}

function appServerConfigLayerMetadata(config: RuntimeConfigState): AppServerConfigLayerMetadata {
  return {
    name: {
      type: 'user',
      file: path.resolve(config.configPath),
      profile: null,
    },
    version: APP_SERVER_CONFIG_LAYER_VERSION,
  };
}

function appServerConfigFeatureEnablement(config: RuntimeConfigState): Record<(typeof APP_SERVER_CONFIG_ENABLEMENT_FEATURES)[number], boolean> {
  return Object.fromEntries(
    APP_SERVER_CONFIG_ENABLEMENT_FEATURES.map((name) => [name, sweFeatureEnabledByName(name, config)]),
  ) as Record<(typeof APP_SERVER_CONFIG_ENABLEMENT_FEATURES)[number], boolean>;
}

function appServerConfigEdit(input: Record<string, unknown>, index?: number): AppServerConfigEdit {
  const prefix = index === undefined ? '' : `edits[${index}].`;
  const keyPath = requiredString(input.keyPath ?? input.key_path, `${prefix}keyPath`);
  const mergeStrategy = stringInput(input.mergeStrategy ?? input.merge_strategy) ?? 'replace';
  if (mergeStrategy !== 'replace' && mergeStrategy !== 'upsert') {
    throw new AppServerRpcError(-32602, `${prefix}mergeStrategy must be replace or upsert`);
  }
  if (!hasOwn(input, 'value')) throw new AppServerRpcError(-32602, `Missing required parameter: ${prefix}value`);
  return { keyPath, value: input.value, mergeStrategy };
}

function sweValidateConfigWriteTarget(
  config: RuntimeConfigState,
  filePath: unknown,
  expectedVersion: unknown,
): void {
  const requestedFile = stringInput(filePath);
  if (requestedFile && path.resolve(requestedFile) !== path.resolve(config.configPath)) {
    throw appServerConfigWriteError('configPathNotFound', `config file is not writable: ${requestedFile}`);
  }
  const version = stringInput(expectedVersion);
  if (version && version !== APP_SERVER_CONFIG_LAYER_VERSION) {
    throw appServerConfigWriteError('configVersionConflict', `config version conflict: expected ${version}`);
  }
}

function appServerConfigWriteError(code: string, message: string): AppServerRpcError {
  return new AppServerRpcError(-32602, message, { config_write_error_code: code });
}

function appServerConfigWriteResponse(config: RuntimeConfigState) {
  return {
    status: 'ok',
    version: APP_SERVER_CONFIG_LAYER_VERSION,
    filePath: path.resolve(config.configPath),
    overriddenMetadata: null,
  };
}

function appServerRuntimeConfigInputFromEdits(config: RuntimeConfigState, edits: AppServerConfigEdit[]): RuntimeConfigInput {
  const next: RuntimeConfigInput = {
    features: { ...(config.features ?? {}) },
    desktopSettings: { ...(config.desktopSettings ?? {}) },
    sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}) },
  };
  let providers: RuntimeConfigInput['providers'];

  const ensureProviders = () => {
    providers ??= config.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
      models: provider.models.map((model) => ({ ...model })),
    }));
    return providers;
  };

  for (const edit of edits) {
    switch (edit.keyPath) {
      case 'model':
        providers = sweProvidersWithActiveModel(config, ensureProviders(), requiredRawString(edit.value, 'model'));
        break;
      case 'model_provider':
        next.activeProviderId = sweProviderIdForWrite(config, requiredRawString(edit.value, 'model_provider'));
        break;
      case 'approval_policy':
        next.approvalPolicy = appServerApprovalPolicyToRuntime(requiredRawString(edit.value, 'approval_policy'));
        break;
      case 'sandbox_mode':
        next.permissionProfile = sweSandboxModeToRuntime(requiredRawString(edit.value, 'sandbox_mode'));
        break;
      case 'sandbox_workspace_write':
        next.sandboxWorkspaceWrite = sweSandboxWorkspaceWriteInput(edit.value);
        break;
      case 'instructions':
        next.globalPrompt = edit.value === null ? '' : requiredRawString(edit.value, 'instructions');
        break;
      case 'model_reasoning_effort':
        providers = sweProvidersWithReasoningEffort(config, ensureProviders(), edit.value);
        break;
      case 'features':
        next.features = sweMergeObject(next.features ?? {}, sweBooleanRecord(edit.value, 'features'), edit.mergeStrategy);
        next.memoryEnabled = next.features.memories ?? config.memoryEnabled;
        break;
      case 'desktop':
        next.desktopSettings = sweMergeObject(next.desktopSettings ?? {}, recordInput(edit.value), edit.mergeStrategy);
        sweApplyDesktopSettings(next, next.desktopSettings);
        break;
      default:
        if (edit.keyPath.startsWith('features.')) {
          const name = edit.keyPath.slice('features.'.length);
          if (typeof edit.value !== 'boolean') throw new AppServerRpcError(-32602, `${edit.keyPath} must be a boolean`);
          next.features = { ...(next.features ?? {}), [name]: edit.value };
          if (name === 'memories') next.memoryEnabled = edit.value;
          break;
        }
        if (edit.keyPath.startsWith('desktop.')) {
          const key = edit.keyPath.slice('desktop.'.length);
          next.desktopSettings = { ...(next.desktopSettings ?? {}), [key]: edit.value };
          sweApplyDesktopSettings(next, { [key]: edit.value });
          break;
        }
        throw appServerConfigWriteError('configValidationError', `Unsupported config key path: ${edit.keyPath}`);
    }
  }

  if (providers) next.providers = providers;
  return next;
}

function sweProvidersWithActiveModel(
  config: RuntimeConfigState,
  providers: NonNullable<RuntimeConfigInput['providers']>,
  modelCode: string,
): NonNullable<RuntimeConfigInput['providers']> {
  const activeProviderId = config.activeProviderId ?? providers[0]?.id;
  return providers.map((provider) => {
    if (provider.id !== activeProviderId) return provider;
    const models = provider.models?.length ? provider.models.map((model) => ({ ...model })) : [];
    const existing = models.find((model) => model.code === modelCode || model.id === modelCode || model.name === modelCode);
    if (existing) {
      return {
        ...provider,
        models: models.map((model) => ({ ...model, enabled: model === existing })),
      };
    }
    return {
      ...provider,
      models: [
        { id: modelCode, name: modelCode, code: modelCode, enabled: true, maxOutputTokens: 68000, thinkingEnabled: false, thinkingEfforts: [] },
        ...models.map((model) => ({ ...model, enabled: false })),
      ],
    };
  });
}

function sweProvidersWithReasoningEffort(
  config: RuntimeConfigState,
  providers: NonNullable<RuntimeConfigInput['providers']>,
  value: unknown,
): NonNullable<RuntimeConfigInput['providers']> {
  const activeProviderId = config.activeProviderId ?? providers[0]?.id;
  const effort = value === null ? undefined : requiredRawString(value, 'model_reasoning_effort');
  return providers.map((provider) => {
    if (provider.id !== activeProviderId) return provider;
    return {
      ...provider,
      models: provider.models?.map((model) => (
        model.enabled
          ? {
              ...model,
              thinkingEnabled: effort ? true : model.thinkingEnabled,
              thinkingEfforts: effort && !model.thinkingEfforts.includes(effort)
                ? [...model.thinkingEfforts, effort]
                : model.thinkingEfforts,
              defaultThinkingEffort: effort,
            }
          : model
      )) ?? [],
    };
  });
}

function sweProviderIdForWrite(config: RuntimeConfigState, value: string): string {
  const exact = config.providers.find((provider) => provider.id === value);
  if (exact) return exact.id;
  const byKind = config.providers.filter((provider) => provider.provider === value);
  if (byKind.length === 1) return byKind[0].id;
  throw appServerConfigWriteError('configValidationError', `Unknown model_provider: ${value}`);
}

function appServerApprovalPolicyToRuntime(value: string): RuntimeConfigState['approvalPolicy'] {
  if (value === 'never') return 'full';
  if (value === 'untrusted') return 'strict';
  if (value === 'on-request') return 'on-request';
  throw appServerConfigWriteError('configValidationError', `Unsupported approval_policy: ${value}`);
}

function sweSandboxModeToRuntime(value: string): RuntimeConfigState['permissionProfile'] {
  if (value === 'read-only') return 'read-only';
  if (value === 'workspace-write') return 'workspace-write';
  if (value === 'danger-full-access') return 'danger-full-access';
  throw appServerConfigWriteError('configValidationError', `Unsupported sandbox_mode: ${value}`);
}

function sweSandboxWorkspaceWriteInput(value: unknown): RuntimeConfigInput['sandboxWorkspaceWrite'] {
  const input = recordInput(value);
  return {
    writableRoots: Array.isArray(input.writable_roots)
      ? input.writable_roots.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    networkAccess: input.network_access === true,
    excludeTmpdirEnvVar: input.exclude_tmpdir_env_var === true,
    excludeSlashTmp: input.exclude_slash_tmp === true,
  };
}

function sweBooleanRecord(value: unknown, name: string): Record<string, boolean> {
  const input = recordInput(value);
  const result: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(input)) {
    if (typeof item !== 'boolean') throw new AppServerRpcError(-32602, `${name}.${key} must be a boolean`);
    result[key] = item;
  }
  return result;
}

function sweMergeObject<T extends Record<string, unknown>>(current: T, update: Record<string, unknown>, strategy: AppServerConfigEdit['mergeStrategy']): T {
  return (strategy === 'replace' ? { ...update } : { ...current, ...update }) as T;
}

function sweApplyDesktopSettings(input: RuntimeConfigInput, settings: Record<string, unknown>): void {
  if (hasOwn(settings, 'memory_enabled')) input.memoryEnabled = settings.memory_enabled === true;
  if (hasOwn(settings, 'setsuna_style')) input.setsunaStyle = settings.setsuna_style as string;
  if (hasOwn(settings, 'storage_path') && typeof settings.storage_path === 'string') {
    input.storagePath = settings.storage_path;
  }
}

function sweSupportedFeatureEnablement(requested: Record<string, unknown>): Record<string, boolean> {
  const enabled: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(requested)) {
    if (!APP_SERVER_CONFIG_ENABLEMENT_FEATURES.includes(name as (typeof APP_SERVER_CONFIG_ENABLEMENT_FEATURES)[number])) {
      continue;
    }
    if (typeof value === 'boolean') enabled[name] = value;
  }
  return enabled;
}

function sweFeatureEnablementRuntimeInput(
  config: RuntimeConfigState,
  enablement: Record<string, boolean>,
): RuntimeConfigInput {
  return {
    features: { ...(config.features ?? {}), ...enablement },
    memoryEnabled: enablement.memories ?? config.memoryEnabled,
  };
}

function sweExperimentalFeatureListResponse(config: RuntimeConfigState, input: Record<string, unknown>) {
  const features = APP_SERVER_EXPERIMENTAL_FEATURES.map((feature) => ({
    name: feature.name,
    stage: feature.stage,
    displayName: feature.displayName,
    description: feature.description,
    announcement: feature.announcement,
    enabled: feature.forceDisabled ? false : sweFeatureEnabledByName(feature.name, config, feature.defaultEnabled),
    defaultEnabled: feature.defaultEnabled,
  }));
  return sweOffsetPage(features, stringInput(input.cursor), numericInput(input.limit), 'feature flags');
}

function sweFeatureEnabledByName(name: string, config: RuntimeConfigState, fallback = false): boolean {
  const configured = config.features?.[name];
  if (typeof configured === 'boolean') return configured;
  switch (name) {
    case 'memories':
      return config.memoryEnabled;
    case 'auth_elicitation':
    case 'remote_control':
    case 'remote_plugin':
      return false;
    case 'mentions_v2':
    case 'tool_suggest':
      return true;
    default:
      return fallback;
  }
}

function sweCollaborationModeListResponse() {
  return {
    data: [
      {
        name: 'Plan',
        mode: 'plan',
        model: null,
        reasoning_effort: 'medium',
      },
      {
        name: 'Default',
        mode: 'default',
        model: null,
        reasoning_effort: null,
      },
    ],
  };
}

function sweModelListResponse(config: RuntimeConfigState, input: Record<string, unknown>) {
  const includeHidden = input.includeHidden === true;
  return sweOffsetPage(
    sweModelCatalog(config, includeHidden),
    stringInput(input.cursor),
    numericInput(input.limit),
    'models',
  );
}

function sweModelProviderCapabilitiesResponse(config: RuntimeConfigState) {
  const provider = activeProviderConfig(config);
  const isOpenAiFamily = provider?.provider === 'openai-compatible' || provider?.provider === 'openai-responses';
  return {
    namespaceTools: true,
    imageGeneration: Boolean(isOpenAiFamily),
    webSearch: Boolean(isOpenAiFamily),
  };
}

function swePermissionProfileListResponse(input: Record<string, unknown>) {
  const profiles: AppServerPermissionProfileSummary[] = [
    { id: ':read-only', description: null, allowed: true },
    { id: ':workspace', description: null, allowed: true },
    { id: ':danger-full-access', description: null, allowed: true },
  ];
  return sweOffsetPage(profiles, stringInput(input.cursor), numericInput(input.limit), 'permission profiles');
}

function sweMcpServerStatusListResponse(
  list: { servers: RuntimeMcpServer[] },
  input: Record<string, unknown>,
) {
  const statuses = [...list.servers]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(sweMcpServerStatus);
  return sweOffsetPage(statuses, stringInput(input.cursor), numericInput(input.limit), 'MCP servers');
}

function sweMcpServerStatus(server: RuntimeMcpServer) {
  return {
    name: server.key,
    serverInfo: null,
    tools: Object.fromEntries(server.tools.map((tool) => [tool.name, {
      description: tool.description ?? null,
    }])),
    resources: [],
    resourceTemplates: [],
    authStatus: 'unsupported',
  };
}

function sweOffsetPage<T>(items: T[], cursor: string | undefined, limit: number | undefined, totalLabel: string) {
  const total = items.length;
  if (total === 0) return { data: [], nextCursor: null };

  const effectiveLimit = Math.min(total, Math.max(1, Math.trunc(limit ?? total)));
  const start = cursor ? sweOffsetCursor(cursor, total, totalLabel) : 0;
  const end = Math.min(total, start + effectiveLimit);
  return {
    data: items.slice(start, end),
    nextCursor: end < total ? String(end) : null,
  };
}

function sweOffsetCursor(cursor: string, total: number, totalLabel: string): number {
  if (!/^\d+$/.test(cursor)) throw new AppServerRpcError(-32600, `invalid cursor: ${cursor}`);
  const start = Number(cursor);
  if (!Number.isSafeInteger(start)) throw new AppServerRpcError(-32600, `invalid cursor: ${cursor}`);
  if (start > total) throw new AppServerRpcError(-32600, `cursor ${start} exceeds total ${totalLabel} ${total}`);
  return start;
}

function sweModelCatalog(config: RuntimeConfigState, includeHidden: boolean): AppServerModelCatalogItem[] {
  const activeProvider = activeProviderConfig(config);
  return config.providers.flatMap((provider) => {
    const defaultModel = activeProvider?.id === provider.id ? activeProviderModel(provider) : null;
    return provider.models
      .map((model) => sweModelCatalogItem(provider, model, defaultModel))
      .filter((model) => includeHidden || !model.hidden);
  });
}

function sweModelCatalogItem(
  provider: ProviderConfigState,
  model: ProviderConfigState['models'][number],
  defaultModel: ProviderConfigState['models'][number] | null,
): AppServerModelCatalogItem {
  const reasoningEfforts = sweReasoningEfforts(model);
  return {
    id: sweModelCatalogId(provider, model),
    model: model.code,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: model.name,
    description: provider.name ? `Provider: ${provider.name}` : '',
    hidden: !provider.enabled || !model.enabled,
    supportedReasoningEfforts: reasoningEfforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: sweReasoningEffortDescription(reasoningEffort),
    })),
    defaultReasoningEffort: model.thinkingEnabled ? model.defaultThinkingEffort ?? reasoningEfforts[0] ?? 'medium' : 'none',
    inputModalities: model.supportsImages ? ['text', 'image'] : ['text'],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: defaultModel?.id === model.id,
  };
}

function sweModelCatalogId(provider: ProviderConfigState, model: ProviderConfigState['models'][number]): string {
  return `${provider.id}:${model.id}`;
}

function sweReasoningEfforts(model: ProviderConfigState['models'][number]): string[] {
  if (!model.thinkingEnabled) return [];
  const seen = new Set<string>();
  const efforts = [...model.thinkingEfforts, model.defaultThinkingEffort]
    .map((effort) => effort?.trim())
    .filter((effort): effort is string => Boolean(effort));
  for (const fallback of efforts.length ? efforts : ['medium']) {
    seen.add(fallback);
  }
  return [...seen];
}

function sweReasoningEffortDescription(effort: string): string {
  switch (effort) {
    case 'none':
      return 'None';
    case 'minimal':
      return 'Minimal';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'xhigh':
      return 'X-High';
    case 'ultra':
      return 'Ultra';
    default:
      return effort;
  }
}

function activeProviderConfig(config: RuntimeConfigState): ProviderConfigState | undefined {
  return config.providers.find((item) => item.id === config.activeProviderId) ?? config.providers[0];
}

function activeProviderModel(provider: ProviderConfigState): ProviderConfigState['models'][number] | null {
  return provider.models.find((model) => model.enabled) ?? provider.models[0] ?? null;
}

function sweLoadedThreadListResponse(threadIds: string[], cursor?: string, limit?: number) {
  const data = [...threadIds].sort();
  const start = cursor ? insertionIndexAfterCursor(data, cursor) : 0;
  const defaultLimit = data.length || 1;
  const effectiveLimit = Math.max(1, Math.trunc(limit ?? defaultLimit));
  const end = Math.min(data.length, start + effectiveLimit);
  const page = data.slice(start, end);
  return {
    data: page,
    nextCursor: end < data.length ? page.at(-1) ?? null : null,
  };
}

function insertionIndexAfterCursor(sortedValues: string[], cursor: string): number {
  const found = sortedValues.indexOf(cursor);
  if (found >= 0) return found + 1;
  const insertionIndex = sortedValues.findIndex((value) => value > cursor);
  return insertionIndex >= 0 ? insertionIndex : sortedValues.length;
}

function sweTurn(
  id: string,
  status: 'inProgress' | 'completed' | 'failed' | 'interrupted',
  options: { items?: AppServerThreadItem[]; itemsView?: AppServerTurnItemsView } = {},
) {
  return {
    id,
    items: options.items ?? [],
    itemsView: options.itemsView ?? 'full',
    status,
    error: null,
    startedAt: null,
    completedAt: status === 'inProgress' ? null : Math.floor(Date.now() / 1000),
    durationMs: null,
  };
}

function sweSandboxPolicy(permissionProfile: string | undefined, cwd: string) {
  if (permissionProfile === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (permissionProfile === 'read-only') return { type: 'readOnly', networkAccess: false };
  return {
    type: 'workspaceWrite',
    writableRoots: [cwd],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: process.platform === 'win32',
  };
}

function sweSandboxMode(permissionProfile: RuntimeConfigState['permissionProfile'] | undefined) {
  if (permissionProfile === 'danger-full-access') return 'danger-full-access';
  if (permissionProfile === 'read-only') return 'read-only';
  return 'workspace-write';
}

function sweSandboxWorkspaceWrite(config: RuntimeConfigState, cwd: string) {
  if (config.permissionProfile !== 'workspace-write') return null;
  const sandbox = config.sandboxWorkspaceWrite ?? {};
  return {
    writable_roots: sandbox.writableRoots?.length ? sandbox.writableRoots : [cwd],
    network_access: sandbox.networkAccess === true,
    exclude_tmpdir_env_var: sandbox.excludeTmpdirEnvVar === true,
    exclude_slash_tmp: sandbox.excludeSlashTmp ?? process.platform === 'win32',
  };
}

function appServerApprovalPolicy(value: string | undefined) {
  if (value === 'full') return 'never';
  if (value === 'strict') return 'untrusted';
  return 'on-request';
}

function activeModelConfig(config: RuntimeConfigState): ProviderConfigState['models'][number] | null {
  const provider = config.providers.find((item) => item.id === config.activeProviderId) ?? config.providers[0];
  return provider?.models.find((model) => model.enabled) ?? provider?.models[0] ?? null;
}

function activeModelReasoningEffort(config: RuntimeConfigState): string | null {
  const model = activeModelConfig(config);
  if (!model?.thinkingEnabled) return null;
  return model.defaultThinkingEffort ?? sweReasoningEfforts(model)[0] ?? null;
}

function activeModelCode(config: Awaited<ReturnType<RuntimeFactory['configStore']['getConfig']>>): string {
  return activeModelConfig(config)?.code ?? 'unknown';
}

function activeModelProvider(config: Awaited<ReturnType<RuntimeFactory['configStore']['getConfig']>>): string {
  const provider = config.providers.find((item) => item.id === config.activeProviderId) ?? config.providers[0];
  return provider?.id ?? 'unknown';
}

function sweUserInputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      const record = recordInput(item);
      return stringInput(record.text) || stringInput(record.value) || stringInput(record.content);
    })
    .filter(Boolean)
    .join('\n');
}

function sweReviewRequestFromTarget(value: unknown): { displayText: string; prompt: string } {
  const target = recordInput(value);
  const type = requiredString(target.type, 'target.type');
  if (type === 'uncommittedChanges') {
    return {
      displayText: 'current changes',
      prompt: sweReviewPrompt('Review the current uncommitted changes.'),
    };
  }
  if (type === 'baseBranch') {
    const branch = stringInput(target.branch);
    if (!branch) throw new AppServerRpcError(-32600, 'branch must not be empty');
    return {
      displayText: `changes against '${branch}'`,
      prompt: sweReviewPrompt(`Review the changes between the current branch and '${branch}'.`),
    };
  }
  if (type === 'commit') {
    const sha = stringInput(target.sha);
    if (!sha) throw new AppServerRpcError(-32600, 'sha must not be empty');
    const title = stringInput(target.title);
    const shortSha = [...sha].slice(0, 7).join('');
    const displayText = title ? `commit ${shortSha}: ${title}` : `commit ${shortSha}`;
    return {
      displayText,
      prompt: sweReviewPrompt(title ? `Review commit ${sha}: ${title}.` : `Review commit ${sha}.`),
    };
  }
  if (type === 'custom') {
    const instructions = stringInput(target.instructions);
    if (!instructions) throw new AppServerRpcError(-32600, 'instructions must not be empty');
    return { displayText: instructions, prompt: instructions };
  }
  throw new AppServerRpcError(-32602, `Unsupported review target: ${type}`);
}

function sweReviewPrompt(scope: string): string {
  return [
    scope,
    'Find bugs, regressions, security issues, and missing tests. Report findings first, ordered by severity, with file and line references when possible.',
    'If there are no actionable findings, say so briefly and mention any residual risk.',
  ].join('\n');
}

function sweReviewUserMessageItem(id: string, text: string): AppServerThreadItem {
  return { type: 'userMessage', id, clientId: null, content: [{ type: 'text', text }] };
}

function sweClientUserMessageId(input: Record<string, unknown>): string | undefined {
  return stringInput(input.clientUserMessageId ?? input.client_user_message_id);
}

function sweSetThreadGoal(thread: RuntimeThread, input: Record<string, unknown>): RuntimeThreadGoal {
  const hasObjective = Object.prototype.hasOwnProperty.call(input, 'objective') && input.objective !== null;
  const objective = hasObjective ? normalizeAppServerGoalObjective(input.objective) : thread.goal?.objective;
  if (!objective) throw new AppServerRpcError(-32602, `cannot update goal for thread ${thread.id}: no goal exists`);

  const status = hasOwn(input, 'status') && input.status !== null
    ? sweGoalStatus(input.status)
    : thread.goal?.status ?? 'active';
  const tokenBudget = hasOwn(input, 'tokenBudget')
    ? sweGoalTokenBudget(input.tokenBudget)
    : thread.goal?.tokenBudget ?? null;
  const now = Math.floor(Date.now() / 1000);
  return {
    threadId: thread.id,
    objective,
    status,
    tokenBudget,
    tokensUsed: thread.goal?.tokensUsed ?? 0,
    timeUsedSeconds: thread.goal?.timeUsedSeconds ?? 0,
    createdAt: thread.goal?.createdAt ?? now,
    updatedAt: now,
  };
}

function normalizeAppServerGoalObjective(value: unknown): string {
  if (typeof value !== 'string') throw new AppServerRpcError(-32602, 'goal objective must be a string');
  const objective = value.trim();
  if (!objective) throw new AppServerRpcError(-32602, 'goal objective must not be empty');
  if ([...objective].length > 4000) throw new AppServerRpcError(-32602, 'goal objective must be at most 4000 characters');
  return objective;
}

function sweGoalStatus(value: unknown): RuntimeThreadGoalStatus {
  if (
    value === 'active' ||
    value === 'paused' ||
    value === 'blocked' ||
    value === 'usageLimited' ||
    value === 'budgetLimited' ||
    value === 'complete'
  ) {
    return value;
  }
  throw new AppServerRpcError(-32602, `Unsupported goal status: ${String(value)}`);
}

function sweGoalTokenBudget(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AppServerRpcError(-32602, 'goal budgets must be positive when provided');
  }
  return value;
}

function swePatchThreadGitInfo(thread: RuntimeThread, input: Record<string, unknown>): RuntimeGitInfo | null {
  const gitInfo = recordInput(input.gitInfo);
  const hasGitInfo = input.gitInfo && typeof input.gitInfo === 'object' && !Array.isArray(input.gitInfo);
  if (!hasGitInfo || (!hasOwn(gitInfo, 'sha') && !hasOwn(gitInfo, 'branch') && !hasOwn(gitInfo, 'originUrl'))) {
    throw new AppServerRpcError(-32602, 'gitInfo must include at least one field');
  }

  const current = thread.gitInfo ?? { sha: null, branch: null, originUrl: null };
  const next: RuntimeGitInfo = {
    sha: hasOwn(gitInfo, 'sha') ? sweGitInfoField(gitInfo.sha, 'gitInfo.sha') : current.sha,
    branch: hasOwn(gitInfo, 'branch') ? sweGitInfoField(gitInfo.branch, 'gitInfo.branch') : current.branch,
    originUrl: hasOwn(gitInfo, 'originUrl') ? sweGitInfoField(gitInfo.originUrl, 'gitInfo.originUrl') : current.originUrl,
  };
  return next.sha || next.branch || next.originUrl ? next : null;
}

function sweGitInfoField(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new AppServerRpcError(-32602, `${name} must be a string or null`);
  const text = value.trim();
  if (!text) throw new AppServerRpcError(-32602, `${name} must not be empty`);
  return text;
}

function sweInjectedResponseItemsToRuntimeMessages(items: unknown[]): RuntimeMessage[] {
  return items.map((item, index) => sweInjectedResponseItemToRuntimeMessage(item, index));
}

function sweInjectedResponseItemToRuntimeMessage(item: unknown, index: number): RuntimeMessage {
  const record = recordInput(item);
  const type = stringInput(record.type);
  if (type === 'message') return sweInjectedMessageToRuntimeMessage(record, index);
  if (type === 'function_call') return sweInjectedFunctionCallToRuntimeMessage(record, index);
  if (type === 'function_call_output') return sweInjectedFunctionCallOutputToRuntimeMessage(record, index);
  throw new AppServerRpcError(-32602, `items[${index}] is not a supported response item: ${type ?? 'unknown'}`);
}

function sweInjectedMessageToRuntimeMessage(item: Record<string, unknown>, index: number): RuntimeMessage {
  const role = sweInjectedMessageRole(requiredString(item.role, `items[${index}].role`), index);
  const parsed = sweInjectedMessageContent(item.content, index);
  return {
    id: stringInput(item.id) || randomRuntimeId('msg_injected'),
    role,
    content: parsed.text,
    attachments: parsed.attachments.length ? parsed.attachments : undefined,
    createdAt: new Date().toISOString(),
    status: 'complete',
    visibility: 'model',
  };
}

function sweInjectedFunctionCallToRuntimeMessage(item: Record<string, unknown>, index: number): RuntimeMessage {
  const callId = requiredString(item.call_id, `items[${index}].call_id`);
  return {
    id: stringInput(item.id) || randomRuntimeId('msg_injected'),
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    status: 'complete',
    visibility: 'model',
    toolCalls: [{
      id: callId,
      name: requiredString(item.name, `items[${index}].name`),
      arguments: sweInjectedFunctionArguments(item.arguments),
    }],
  };
}

function sweInjectedFunctionCallOutputToRuntimeMessage(item: Record<string, unknown>, index: number): RuntimeMessage {
  const callId = requiredString(item.call_id, `items[${index}].call_id`);
  return {
    id: stringInput(item.id) || randomRuntimeId('msg_injected'),
    role: 'tool',
    content: sweInjectedFunctionOutputText(item.output),
    createdAt: new Date().toISOString(),
    status: 'complete',
    visibility: 'model',
    toolCallId: callId,
  };
}

function sweInjectedMessageRole(role: string, index: number): RuntimeMessage['role'] {
  if (role === 'user' || role === 'assistant' || role === 'system') return role;
  if (role === 'developer') return 'system';
  throw new AppServerRpcError(-32602, `items[${index}].role is not supported: ${role}`);
}

function sweInjectedMessageContent(content: unknown, index: number): { attachments: NonNullable<RuntimeMessage['attachments']>; text: string } {
  if (typeof content === 'string') return { attachments: [], text: content };
  if (!Array.isArray(content)) throw new AppServerRpcError(-32602, `items[${index}].content must be an array`);
  const attachments: NonNullable<RuntimeMessage['attachments']> = [];
  const textParts: string[] = [];
  for (const [partIndex, part] of content.entries()) {
    if (typeof part === 'string') {
      textParts.push(part);
      continue;
    }
    const record = recordInput(part);
    const type = stringInput(record.type);
    if (type === 'input_text' || type === 'output_text' || type === 'text') {
      textParts.push(requiredRawString(record.text, `items[${index}].content[${partIndex}].text`));
      continue;
    }
    if (type === 'input_image') {
      const url = requiredString(record.image_url, `items[${index}].content[${partIndex}].image_url`);
      attachments.push({
        id: randomRuntimeId('attachment_injected'),
        name: 'Injected image',
        type: 'image/*',
        size: 0,
        url,
      });
      continue;
    }
    throw new AppServerRpcError(-32602, `items[${index}].content[${partIndex}] is not supported: ${type ?? 'unknown'}`);
  }
  return { attachments, text: textParts.join('\n') };
}

function sweInjectedFunctionArguments(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function sweInjectedFunctionOutputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output
      .map((item) => {
        if (typeof item === 'string') return item;
        const record = recordInput(item);
        return typeof record.text === 'string' ? record.text : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  const record = recordInput(output);
  if (typeof record.content === 'string') return record.content;
  if (Array.isArray(record.content)) return sweInjectedFunctionOutputText(record.content);
  return output === undefined || output === null ? '' : JSON.stringify(output);
}

function appServerApprovalAnswerFromResponse(request: AppServerRpcRequest): AnswerRuntimeApprovalInput {
  if (request.error) {
    const error = recordInput(request.error);
    return { decision: 'reject', message: stringInput(error.message) ?? 'Approval request failed.' };
  }
  const result = recordInput(request.result);
  const decision = result.decision;
  if (decision === 'accept' || decision === 'acceptForSession' || isAppServerApprovalAcceptObject(decision)) {
    return { decision: 'approve' };
  }
  if (decision === 'decline' || decision === 'cancel') {
    return { decision: 'reject' };
  }
  throw new AppServerRpcError(-32602, 'Unsupported approval decision', { decision });
}

function isAppServerApprovalAcceptObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return 'acceptWithExecpolicyAmendment' in value || 'applyNetworkPolicyAmendment' in value;
}

function requiredString(value: unknown, name: string): string {
  const text = stringInput(value);
  if (!text) throw new AppServerRpcError(-32602, `Missing required parameter: ${name}`);
  return text;
}

function requiredPositiveInteger(value: unknown, name: string): number {
  const numeric = numericInput(value);
  if (numeric === undefined || numeric < 1 || !Number.isInteger(numeric)) {
    throw new AppServerRpcError(-32602, `${name} must be >= 1`);
  }
  return numeric;
}

function requiredArray(value: unknown, name: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new AppServerRpcError(-32602, `${name} must be an array`);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function requiredRawString(value: unknown, name: string): string {
  if (typeof value === 'string') return value;
  throw new AppServerRpcError(-32602, `Missing required parameter: ${name}`);
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numericInput(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toUnixSeconds(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

function parseDateMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function compareNullableMs(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function minNullableMs(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

function maxNullableMs(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function platformOs(): string {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

async function readBody<T = unknown>(request: IncomingMessage, fallback?: T): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(buffer);
  }
  if (!chunks.length) {
    if (fallback !== undefined) return fallback;
    return {} as T;
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  if (response.headersSent) return;
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function optionalNumber(value: string | null): number | undefined {
  if (value === null || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function memoryScope(value: string | null): 'global' | 'project' | undefined {
  if (value === 'global' || value === 'project') return value;
  return undefined;
}

function threadScope(value: string | null): ThreadQuery['scope'] {
  if (value === 'all' || value === 'global' || value === 'project') return value;
  return undefined;
}

function isRuntimeMessageAttachment(value: unknown): value is NonNullable<SendTurnInput['attachments']>[number] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.type === 'string' &&
    typeof record.size === 'number' &&
    Number.isFinite(record.size) &&
    typeof record.url === 'string'
  );
}

function stringInput(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
