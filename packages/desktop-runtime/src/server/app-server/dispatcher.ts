import path from 'node:path';
import type { RuntimeCollaborationMode, RuntimePlanDecision, ThreadQuery } from '@setsuna-desktop/contracts';
import type { RuntimeFactory, RuntimeServerOptions } from '../types.js';
import {
  callMcpServerToolResponse,
  listMcpServerResources,
  listMcpServerResourceTemplates,
  readMcpServerResource,
} from '../../adapters/mcp/mcp-tool-discovery.js';
import type { AppServerCommandExecManager } from './command-exec.js';
import type { AppServerConnectionRegistry } from './connections.js';
import { appServerDynamicToolsInput } from './dynamic-tools.js';
import { AppServerRpcError } from './errors.js';
import {
  appServerFsCopy,
  appServerFsCreateDirectory,
  appServerFsGetMetadata,
  appServerFsReadDirectory,
  appServerFsReadFile,
  appServerFsRemove,
  appServerFsWriteFile,
  type AppServerFsManager,
} from './fs-protocol.js';
import { appServerHooksListResponse } from './hooks-protocol.js';
import { recordInput, requiredArray, requiredPositiveInteger, requiredString, stringInput, numericInput } from './input.js';
import { platformOs } from './platform.js';
import {
  appServerSkillsConfigWriteResponse,
  appServerSkillsExtraRootsSetResponse,
  appServerSkillsListResponse,
} from './skills-protocol.js';
import {
  appendAndPublishRuntimeEvent,
  cancelRuntimeTurn,
  copyRuntimeMessagesToThread,
  randomRuntimeId,
  requireRuntimeThread,
  rollbackStartMessageId,
  runAppServerThreadShellCommand,
  runtimeMessagesThroughTurn,
} from '../runtime-thread-events.js';
import {
  appServerConfigEdit,
  appServerConfigReadResponse,
  appServerConfigWriteResponse,
  appServerRuntimeConfigInputFromEdits,
  sweClientUserMessageId,
  sweCollaborationModeListResponse,
  sweExperimentalFeatureListResponse,
  sweFeatureEnablementRuntimeInput,
  sweInjectedResponseItemsToRuntimeMessages,
  sweInitialTurnsPage,
  sweLoadedThreadListResponse,
  sweMcpServerStatusListResponse,
  type AppServerMcpStatusInventory,
  sweModelListResponse,
  sweModelProviderCapabilitiesResponse,
  swePatchThreadGitInfo,
  swePermissionProfileListResponse,
  sweReviewRequestFromTarget,
  sweReviewUserMessageItem,
  sweSetThreadGoal,
  sweSupportedFeatureEnablement,
  sweThreadFromRuntimeSummary,
  sweThreadFromRuntimeThread,
  sweThreadItemsListResponse,
  sweThreadMemoryModeSetInput,
  sweThreadSessionResponse,
  sweThreadTurnsListResponse,
  sweTurn,
  sweUserInputText,
  sweValidateConfigWriteTarget,
} from './protocol.js';

export async function dispatchAppServerRpcRequest(
  runtime: RuntimeFactory,
  method: string,
  params: unknown,
  options: RuntimeServerOptions,
  commandExecManager: AppServerCommandExecManager,
  fsManager: AppServerFsManager,
  connectionId?: string,
  connectionRegistry?: AppServerConnectionRegistry,
): Promise<unknown> {
  if (method === 'initialize') {
    connectionRegistry?.initialize(connectionId, params);
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

  if (method === 'hooks/list') {
    return appServerHooksListResponse(runtime, params);
  }

  if (method === 'skills/list') {
    return appServerSkillsListResponse(runtime, params);
  }

  if (method === 'skills/extraRoots/set') {
    return appServerSkillsExtraRootsSetResponse(runtime, params);
  }

  if (method === 'skills/config/write') {
    return appServerSkillsConfigWriteResponse(runtime, params);
  }

  if (method === 'mcpServerStatus/list') {
    const input = recordInput(params);
    return sweMcpServerStatusListResponse(
      await runtime.mcpStore.listServers(),
      input,
      await appServerMcpStatusInventory(runtime, input),
    );
  }

  if (method === 'config/mcpServer/reload') {
    await runtime.mcpStore.listServers();
    return {};
  }

  if (method === 'mcpServer/oauth/login') {
    const input = recordInput(params);
    const name = requiredString(input.name, 'name');
    const threadId = stringInput(input.threadId ?? input.thread_id);
    if (threadId) await requireRuntimeThread(runtime, threadId);
    const server = (await runtime.mcpStore.listServerInputs()).find((item) => item.key === name);
    if (!server) throw new AppServerRpcError(-32600, `No MCP server named '${name}' found.`);
    if (server.transport !== 'streamableHttp') {
      throw new AppServerRpcError(-32600, 'OAuth login is only supported for streamable HTTP servers.');
    }
    throw new AppServerRpcError(
      -32603,
      `failed to login to MCP server '${name}': MCP OAuth browser login is not available in the local HTTP app-server adapter yet`,
    );
  }

  if (method === 'mcpServer/resource/read') {
    const input = recordInput(params);
    const threadId = stringInput(input.threadId ?? input.thread_id);
    if (threadId) await requireRuntimeThread(runtime, threadId);
    const serverKey = requiredString(input.server, 'server');
    const uri = requiredString(input.uri, 'uri');
    const server = (await runtime.mcpStore.listServerInputs()).find((item) => item.key === serverKey);
    if (!server) throw new AppServerRpcError(-32602, `MCP server not found: ${serverKey}`);
    return readMcpServerResource(server, uri);
  }

  if (method === 'mcpServer/tool/call') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId ?? input.thread_id, 'threadId');
    await requireRuntimeThread(runtime, threadId);
    const serverKey = requiredString(input.server, 'server');
    const toolName = requiredString(input.tool, 'tool');
    const server = (await runtime.mcpStore.listServerInputs()).find((item) => item.key === serverKey);
    if (!server) throw new AppServerRpcError(-32602, `MCP server not found: ${serverKey}`);
    return callMcpServerToolResponse(server, toolName, input.arguments);
  }

  if (method === 'fs/readFile') {
    return appServerFsReadFile(runtime, params);
  }

  if (method === 'fs/writeFile') {
    return appServerFsWriteFile(runtime, params);
  }

  if (method === 'fs/createDirectory') {
    return appServerFsCreateDirectory(runtime, params);
  }

  if (method === 'fs/getMetadata') {
    return appServerFsGetMetadata(runtime, params);
  }

  if (method === 'fs/readDirectory') {
    return appServerFsReadDirectory(runtime, params);
  }

  if (method === 'fs/remove') {
    return appServerFsRemove(runtime, params);
  }

  if (method === 'fs/copy') {
    return appServerFsCopy(runtime, params);
  }

  if (method === 'fs/watch') {
    return fsManager.watch(runtime, params, connectionId);
  }

  if (method === 'fs/unwatch') {
    return fsManager.unwatch(params, connectionId);
  }

  if (method === 'command/exec') {
    return await commandExecManager.exec(params, connectionId);
  }

  if (method === 'command/exec/write') {
    return commandExecManager.write(params, connectionId);
  }

  if (method === 'command/exec/terminate') {
    return commandExecManager.terminate(params, connectionId);
  }

  if (method === 'command/exec/resize') {
    return commandExecManager.resize(params, connectionId);
  }

  if (method === 'process/spawn') {
    return commandExecManager.processSpawn(params, connectionId);
  }

  if (method === 'process/writeStdin') {
    return commandExecManager.processWriteStdin(params, connectionId);
  }

  if (method === 'process/kill') {
    return commandExecManager.processKill(params, connectionId);
  }

  if (method === 'process/resizePty') {
    return commandExecManager.processResizePty(params, connectionId);
  }

  if (method === 'thread/backgroundTerminals/list') {
    const input = recordInput(params);
    await requireRuntimeThread(runtime, requiredString(input.threadId ?? input.thread_id, 'threadId'));
    return commandExecManager.backgroundTerminalsList(params, connectionId);
  }

  if (method === 'thread/backgroundTerminals/clean') {
    const input = recordInput(params);
    await requireRuntimeThread(runtime, requiredString(input.threadId ?? input.thread_id, 'threadId'));
    return commandExecManager.backgroundTerminalsClean(params, connectionId);
  }

  if (method === 'thread/backgroundTerminals/terminate') {
    const input = recordInput(params);
    await requireRuntimeThread(runtime, requiredString(input.threadId ?? input.thread_id, 'threadId'));
    return commandExecManager.backgroundTerminalsTerminate(params, connectionId);
  }

  if (method === 'thread/start') {
    const input = recordInput(params);
    const cwd = stringInput(input.cwd) || process.cwd();
    if (hasAppServerDynamicToolsInput(input)) requireExperimentalAppServerApi(connectionRegistry, connectionId, 'dynamicTools');
    const dynamicTools = appServerDynamicToolsInput(input.dynamicTools ?? input.dynamic_tools);
    const thread = await runtime.threadStore.createThread({
      title: stringInput(input.name) || stringInput(input.threadName) || path.basename(cwd) || 'New thread',
      projectId: stringInput(input.projectId),
    });
    if (dynamicTools !== undefined) {
      runtime.agentLoop.registerAppServerDynamicTools(thread.id, dynamicTools, connectionId ?? 'default');
    }
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
      ancestorThreadId: stringInput(input.ancestorThreadId ?? input.ancestor_thread_id),
      includeArchived: input.archived === true,
      parentThreadId: stringInput(input.parentThreadId ?? input.parent_thread_id),
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

  if (method === 'thread/memoryMode/set') {
    const input = sweThreadMemoryModeSetInput(params);
    await requireRuntimeThread(runtime, input.threadId);
    await runtime.threadStore.updateThreadMemoryMode(input.threadId, input.mode, 'user_request');
    return {};
  }

  if (method === 'memory/reset') {
    await runtime.memoryStore.clearMemories();
    return {};
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
    runtime.agentLoop.clearAppServerDynamicTools(threadId);
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
    const activeTurnId = runtime.agentLoop.activeTurnId(threadId);
    if (activeTurnId) await runtime.agentLoop.cancelTurn(threadId, activeTurnId);
    const currentThread = await runtime.threadStore.getThread(threadId) ?? thread;
    const rollbackMessageId = rollbackStartMessageId(currentThread.messages, numTurns);
    const rolledBack = rollbackMessageId
      ? await runtime.threadStore.truncateMessagesAfter(threadId, rollbackMessageId, true)
      : currentThread;
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
    const collaborationMode = appServerCollaborationMode(input.collaborationMode ?? input.collaboration_mode ?? input.mode);
    const thinking = appServerTurnThinkingInput(input, collaborationMode);
    if (hasAppServerDynamicToolsInput(input)) requireExperimentalAppServerApi(connectionRegistry, connectionId, 'dynamicTools');
    const dynamicTools = appServerDynamicToolsInput(input.dynamicTools ?? input.dynamic_tools);
    if (dynamicTools !== undefined) {
      await requireRuntimeThread(runtime, threadId);
      runtime.agentLoop.registerAppServerDynamicTools(threadId, dynamicTools, connectionId ?? 'default');
    }
    const started = await runtime.agentLoop.startTurn(threadId, {
      input: text,
      clientId: sweClientUserMessageId(input),
      ...(collaborationMode ? { collaborationMode } : {}),
      ...appServerPlanDecisionInput(input.planDecision ?? input.plan_decision),
      ...thinking,
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

  if (method === 'turn/mailbox/deliver') {
    const input = recordInput(params);
    const threadId = requiredString(input.threadId ?? input.thread_id, 'threadId');
    const expectedTurnId = stringInput(input.expectedTurnId ?? input.expected_turn_id);
    const content = requiredString(input.content, 'content');
    try {
      const delivered = await runtime.agentLoop.deliverMailboxInput(threadId, {
        content,
        deliveryMode: mailboxDeliveryMode(input.deliveryMode ?? input.delivery_mode),
        expectedTurnId,
        fromAgentId: stringInput(input.fromAgentId ?? input.from_agent_id),
        fromThreadId: stringInput(input.fromThreadId ?? input.from_thread_id),
        id: stringInput(input.id),
        toAgentId: stringInput(input.toAgentId ?? input.to_agent_id),
        triggerTurn: booleanInput(input.triggerTurn ?? input.trigger_turn),
      });
      return { queued: delivered.queued ?? false, turnId: delivered.turnId };
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

async function appServerMcpStatusInventory(
  runtime: RuntimeFactory,
  input: Record<string, unknown>,
): Promise<AppServerMcpStatusInventory> {
  const detail = stringInput(input.detail);
  if (detail === 'toolsAndAuthOnly') return {};
  if (detail && detail !== 'full') throw new AppServerRpcError(-32602, `Invalid MCP server status detail: ${detail}`);

  const servers = (await runtime.mcpStore.listServerInputs()).filter((server) => server.enabled !== false);
  const entries = await Promise.all(servers.map(async (server) => {
    const [resources, resourceTemplates] = await Promise.all([
      listMcpServerResources(server).catch(() => []),
      listMcpServerResourceTemplates(server).catch(() => []),
    ]);
    return [server.key, { resources, resourceTemplates }] as const;
  }));
  return Object.fromEntries(entries);
}

function hasAppServerDynamicToolsInput(input: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(input, 'dynamicTools')
    || Object.prototype.hasOwnProperty.call(input, 'dynamic_tools');
}

function requireExperimentalAppServerApi(
  registry: AppServerConnectionRegistry | undefined,
  connectionId: string | undefined,
  feature: string,
): void {
  if (registry?.experimentalApi(connectionId)) return;
  throw new AppServerRpcError(-32600, `${feature} requires initialize.params.capabilities.experimentalApi = true`);
}

function booleanInput(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

function mailboxDeliveryMode(value: unknown): 'queue_only' | 'trigger_turn' | undefined {
  const text = stringInput(value);
  if (!text) return undefined;
  if (text === 'queue_only' || text === 'trigger_turn') return text;
  throw new AppServerRpcError(-32602, 'deliveryMode must be queue_only or trigger_turn');
}

function appServerTurnThinkingInput(input: Record<string, unknown>, collaborationMode: RuntimeCollaborationMode | ''): { thinking?: boolean; thinkingEffort?: string } {
  const reasoningEffort = stringInput(input.reasoningEffort ?? input.reasoning_effort ?? input.thinkingEffort ?? input.thinking_effort);
  const explicitThinking = typeof input.thinking === 'boolean' ? input.thinking : undefined;
  const planMode = collaborationMode === 'plan';
  const thinking = explicitThinking ?? (planMode || Boolean(reasoningEffort) ? true : undefined);
  const thinkingEffort = reasoningEffort ?? (planMode ? 'medium' : undefined);
  return {
    ...(thinking !== undefined ? { thinking } : {}),
    ...(thinking && thinkingEffort ? { thinkingEffort } : {}),
  };
}

function appServerCollaborationMode(value: unknown): RuntimeCollaborationMode | '' {
  const text = typeof value === 'string' ? value.trim() : stringInput(recordInput(value).mode) ?? '';
  if (!text) return '';
  if (text === 'default' || text === 'plan') return text;
  throw new AppServerRpcError(-32602, 'collaborationMode must be default or plan');
}

function appServerPlanDecisionInput(value: unknown): { planDecision?: RuntimePlanDecision } {
  const text = stringInput(value);
  if (!text) return {};
  if (text === 'accepted' || text === 'dismissed') return { planDecision: text };
  throw new AppServerRpcError(-32602, 'planDecision must be accepted or dismissed');
}
