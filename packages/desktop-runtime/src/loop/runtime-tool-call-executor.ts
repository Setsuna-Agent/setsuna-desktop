import type {
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
  RuntimeCollabToolCall,
  RuntimeConfigState,
  RuntimeDynamicToolCallResult,
  RuntimeDynamicToolDefinition,
  RuntimeHookRun,
  RuntimeMessage,
  RuntimePluginReference,
  RuntimeStreamItem,
  RuntimeToolCall,
  RuntimeToolCallDelta,
} from '@setsuna-desktop/contracts';
import type { AppServerNotificationBus } from '../ports/app-server-notification-bus.js';
import type { ApprovalGate } from '../ports/approval-gate.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { GeneratedImageStore } from '../ports/generated-image-store.js';
import type { PolicyAmendmentStore } from '../ports/policy-amendment-store.js';
import type { PersistentToolApprovalStore } from '../ports/persistent-tool-approval-store.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { RuntimeToolExecutionContext, ToolHost, ToolOutputDelta } from '../ports/tool-host.js';
import { createRuntimeToolHookRunner } from '../hooks/runtime-hooks.js';
import { collaborationToolsEnabled, isCollaborationToolName, type RuntimeCollaborationCoordinator } from './collaboration-coordinator.js';
import { isGoalToolName, type RuntimeGoalCoordinator } from './runtime-goal-coordinator.js';
import { FILE_MUTATION_TOOL_NAMES, ToolApprovalStore, ToolOrchestrator } from './tool-orchestrator.js';
import { RuntimeToolRouter } from './tool-router.js';
import type { RuntimeMemoryCoordinator } from './runtime-memory-coordinator.js';
import { externalizeToolImageAttachments } from './runtime-tool-image-assets.js';
import { isAbortError, throwIfAborted, TurnCancelledError } from './runtime-turn-errors.js';
import {
  appServerDynamicToolContent,
  appServerDynamicToolErrorMessage,
  appServerDynamicToolResult,
  appServerRpcId,
  mergeToolArgumentDelta,
  parallelReadFileKey,
  parseToolArguments,
  previewArguments,
  previewPartialArguments,
  previewToolContent,
  unifiedDiffFromToolPreview,
} from './agent-loop-tool-utils.js';

const APP_SERVER_DYNAMIC_TOOL_TIMEOUT_MS = 120_000;
const TOOL_PREVIEW_ARGUMENT_GROWTH_THRESHOLD = 1_024;

type RuntimeToolCallDeltaLike = Pick<RuntimeToolCallDelta, 'id' | 'name' | 'argumentsDelta'>;

export type ToolPreviewAnnouncement = {
  argumentsLength: number;
  signature: string;
};

type AppServerDynamicToolRegistration = {
  connectionId: string;
  tools: RuntimeDynamicToolDefinition[];
  toolsByName: Map<string, RuntimeDynamicToolDefinition>;
};

type AppServerDynamicToolLookup = {
  registration: AppServerDynamicToolRegistration;
  tool: RuntimeDynamicToolDefinition;
};

type PendingAppServerDynamicToolCall = {
  reject(error: Error): void;
  resolve(result: RuntimeDynamicToolCallResult): void;
};

type RuntimeToolCallExecutorOptions = {
  approvalGate?: ApprovalGate;
  appServerNotificationBus?: AppServerNotificationBus;
  clock: Clock;
  ids: IdGenerator;
  imageStore?: GeneratedImageStore;
  memory: RuntimeMemoryCoordinator;
  policyAmendmentStore?: PolicyAmendmentStore;
  persistentToolApprovalStore?: PersistentToolApprovalStore;
  toolHost?: ToolHost;
  collaborationCoordinator(): RuntimeCollaborationCoordinator;
  goalCoordinator(): RuntimeGoalCoordinator;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
  publishMessage(threadId: string, turnId: string, message: RuntimeMessage): Promise<void>;
};

/** 管理工具审批、执行及相关事件投影。 */
export class RuntimeToolCallExecutor {
  private readonly toolApprovalStore = new ToolApprovalStore();
  private readonly appServerDynamicToolsByThread = new Map<string, AppServerDynamicToolRegistration>();
  private readonly pendingAppServerDynamicToolCalls = new Map<string, PendingAppServerDynamicToolCall>();

  constructor(private readonly options: RuntimeToolCallExecutorOptions) {}

  shutdown(error: Error): void {
    for (const pending of this.pendingAppServerDynamicToolCalls.values()) pending.reject(error);
    this.pendingAppServerDynamicToolCalls.clear();
    this.appServerDynamicToolsByThread.clear();
  }

  registerDynamicTools(threadId: string, tools: RuntimeDynamicToolDefinition[], connectionId: string): void {
    if (!tools.length) {
      this.appServerDynamicToolsByThread.delete(threadId);
      return;
    }
    this.appServerDynamicToolsByThread.set(threadId, {
      connectionId,
      tools,
      toolsByName: new Map(tools.map((tool) => [tool.name, tool])),
    });
  }

  clearDynamicTools(threadId: string): void {
    this.appServerDynamicToolsByThread.delete(threadId);
  }

  answerDynamicToolResponse(id: string | number | null | undefined, response: { result?: unknown; error?: unknown }): boolean {
    const requestId = appServerRpcId(id);
    if (!requestId) return false;
    const pending = this.pendingAppServerDynamicToolCalls.get(requestId);
    if (!pending) return false;
    this.pendingAppServerDynamicToolCalls.delete(requestId);
    if (response.error !== undefined) {
      pending.reject(new Error(appServerDynamicToolErrorMessage(response.error)));
      return true;
    }
    try {
      pending.resolve(appServerDynamicToolResult(response.result));
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return true;
  }

  dynamicToolsForThread(threadId: string): RuntimeDynamicToolDefinition[] | undefined {
    return this.appServerDynamicToolsByThread.get(threadId)?.tools;
  }

  async runToolCalls(toolCalls: RuntimeToolCall[], context: RuntimeToolExecutionContext, toolRouter: RuntimeToolRouter | null, runtimeConfig: RuntimeConfigState | null | undefined): Promise<RuntimeMessage[]> {
    const messages: RuntimeMessage[] = [];
    for (let index = 0; index < toolCalls.length; ) {
      const parallelBatch = toolRouter
        ? await this.collectParallelToolBatch(toolCalls, index, toolRouter)
        : [];
      if (parallelBatch.length > 1) {
        // collect 阶段已确认这一连续批次都支持并行，可直接跳过逐项审批检查。
        const executions = await Promise.all(parallelBatch.map((toolCall) => this.runSingleToolCall(toolCall, context, toolRouter, runtimeConfig, { skipApproval: true })));
        messages.push(...executions);
        index += parallelBatch.length;
        continue;
      }

      const toolCall = toolCalls[index];
      messages.push(await this.runSingleToolCall(toolCall, context, toolRouter, runtimeConfig));
      index += 1;
    }
    return messages;
  }

  /**
   * 从当前位置开始收集一个连续的可并行只读工具批次。
   *
   * @param toolCalls 完整工具调用列表。
   * @param startIndex 本次尝试收集的起始下标。
   * @param toolRouter 当前 sampling step 捕获的工具路由器。
   */
  private async collectParallelToolBatch(toolCalls: RuntimeToolCall[], startIndex: number, toolRouter: RuntimeToolRouter): Promise<RuntimeToolCall[]> {
    const readFileKeys = new Set<string>();
    const batch: RuntimeToolCall[] = [];
    // 只收集连续批次；保留模型输出顺序，避免后面的工具依赖前一个工具结果时被提前执行。
    for (let index = startIndex; index < toolCalls.length; index += 1) {
      const toolCall = toolCalls[index];
      const parsedArguments = parseToolArguments(toolCall.arguments);
      if (!(await toolRouter.canRunInParallel(toolCall, parsedArguments))) break;
      const readFileKey = parallelReadFileKey(toolCall, parsedArguments);
      // 同一个文件片段重复读取不并行，避免浪费上下文并让模型误以为拿到了不同信息。
      if (readFileKey && readFileKeys.has(readFileKey)) break;
      if (readFileKey) readFileKeys.add(readFileKey);
      batch.push(toolCall);
    }
    return batch;
  }

  /**
   * 执行单个工具调用，负责预览、审批、运行、结果事件和 tool 消息。
   *
   * @param toolCall 要执行的工具调用。
   * @param context 当前工具执行上下文。
   * @param toolRouter 当前 sampling step 捕获的工具路由器。
   * @param options 批处理场景下可跳过审批的内部选项。
   */
  private async runSingleToolCall(toolCall: RuntimeToolCall, context: RuntimeToolExecutionContext, toolRouter: RuntimeToolRouter | null, runtimeConfig: RuntimeConfigState | null | undefined, options: { skipApproval?: boolean } = {}): Promise<RuntimeMessage> {
    let content = '';
    let attachments: RuntimeMessage['attachments'];
    let parsedArguments: unknown;
    try {
      throwIfAborted(context.signal);
      parsedArguments = parseToolArguments(toolCall.arguments);
      if (isCollaborationToolName(toolCall.name)) {
        if (!collaborationToolsEnabled(runtimeConfig)) {
          content = `Tool ${toolCall.name} failed: multi_agent feature is disabled.`;
          await this.publishToolCompleted(context.threadId, context.turnId, toolCall, parsedArguments, 'error', content);
          return this.publishToolMessage(context.threadId, context.turnId, toolCall, content);
        }
        const execution = await this.runCollaborationToolCall(toolCall, parsedArguments, context);
        return this.publishToolMessage(context.threadId, context.turnId, toolCall, execution.content);
      }
      if (isGoalToolName(toolCall.name)) {
        const execution = await this.runGoalToolCall(toolCall, parsedArguments, context);
        return this.publishToolMessage(context.threadId, context.turnId, toolCall, execution.content);
      }
      const dynamicTool = this.appServerDynamicToolForCall(context.threadId, toolCall.name, toolRouter);
      if (dynamicTool) {
        const execution = await this.runAppServerDynamicToolCall(toolCall, parsedArguments, context, dynamicTool.registration, dynamicTool.tool);
        return this.publishToolMessage(context.threadId, context.turnId, toolCall, execution.content);
      }
      const memoryBlock = await this.options.memory.toolBlockForCall(toolCall, context.threadId, runtimeConfig);
      if (memoryBlock) {
        content = memoryBlock;
        await this.publishToolCompleted(context.threadId, context.turnId, toolCall, parsedArguments, 'error', content);
        return this.publishToolMessage(context.threadId, context.turnId, toolCall, content);
      }
      if (!toolRouter) {
        content = `Tool ${toolCall.name} failed: no tool host is available.`;
        await this.publishToolCompleted(context.threadId, context.turnId, toolCall, parsedArguments, 'error', content);
        return this.publishToolMessage(context.threadId, context.turnId, toolCall, content);
      }
      const execution = await toolRouter.runToolCall(toolCall, parsedArguments, {
        checkApproval: options.skipApproval !== true,
        postProcessResult: async (result) => {
          const processedResult = {
            ...result,
            attachments: await externalizeToolImageAttachments(result.attachments, this.options.imageStore),
          };
          await this.options.memory.markPollutedByExternalContext(context.threadId, context.turnId, toolCall, processedResult, runtimeConfig);
          return processedResult;
        },
      });
      content = execution.content;
      attachments = execution.result?.attachments;
    } catch (error) {
      if (isAbortError(error)) throw error;
      content = `Tool ${toolCall.name} failed: ${error instanceof Error ? error.message : String(error)}`;
      await this.publishToolCompleted(context.threadId, context.turnId, toolCall, parsedArguments, 'error', content);
    }
    return this.publishToolMessage(context.threadId, context.turnId, toolCall, content, attachments);
  }

  private appServerDynamicToolForCall(threadId: string, name: string, toolRouter: RuntimeToolRouter | null): AppServerDynamicToolLookup | null {
    const registration = this.appServerDynamicToolsByThread.get(threadId);
    const tool = registration?.toolsByName.get(name);
    if (!registration || !tool) return null;
    // 如果本地 ToolHost 中存在同名的面向模型工具，则由本地 runtime 负责执行；
    // 动态工具只会追加到尚未占用的名称上。
    if (toolRouter?.hasTool(name)) return null;
    return { registration, tool };
  }

  private async runAppServerDynamicToolCall(
    toolCall: RuntimeToolCall,
    parsedArguments: unknown,
    context: RuntimeToolExecutionContext,
    registration: AppServerDynamicToolRegistration,
    tool: RuntimeDynamicToolDefinition,
  ): Promise<{ content: string }> {
    if (!this.options.appServerNotificationBus) throw new Error('AppServer dynamic tool runtime is unavailable.');
    const startedAtMs = this.options.clock.now().getTime();
    await this.publishToolStarted(context.threadId, context.turnId, toolCall, parsedArguments);
    const requestId = this.options.ids.id('dynamic_tool_call');
    const pending = this.waitForAppServerDynamicToolResponse(requestId, context.signal, APP_SERVER_DYNAMIC_TOOL_TIMEOUT_MS);
    this.options.appServerNotificationBus.publish({
      method: 'item/tool/call',
      id: requestId,
      params: {
        threadId: context.threadId,
        turnId: context.turnId,
        callId: toolCall.id,
        namespace: tool.namespace ?? null,
        tool: tool.toolName,
        arguments: parsedArguments ?? {},
      },
    }, { connectionId: registration.connectionId });
    const result = await pending;
    const success = result.success !== false;
    const content = appServerDynamicToolContent(result.contentItems, success);
    await this.publishToolCompleted(context.threadId, context.turnId, toolCall, parsedArguments, success ? 'success' : 'error', content, {
      data: {
        contentItems: result.contentItems,
        namespace: tool.namespace ?? null,
        success,
        tool: tool.toolName,
      },
      resultPreview: content,
      startedAtMs,
    });
    return { content };
  }

  private waitForAppServerDynamicToolResponse(requestId: string, signal: AbortSignal, timeoutMs: number): Promise<RuntimeDynamicToolCallResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        this.pendingAppServerDynamicToolCalls.delete(requestId);
        fn();
      };
      timeout = setTimeout(() => {
        settle(() => reject(new Error(`Dynamic tool call timed out: ${requestId}`)));
      }, timeoutMs);
      const abort = () => {
        settle(() => reject(new TurnCancelledError()));
      };
      signal.addEventListener('abort', abort, { once: true });
      this.pendingAppServerDynamicToolCalls.set(requestId, {
        resolve: (result) => settle(() => resolve(result)),
        reject: (error) => settle(() => reject(error)),
      });
      if (signal.aborted) abort();
    });
  }

  private async runCollaborationToolCall(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext): Promise<{ content: string }> {
    const startedAtMs = this.options.clock.now().getTime();
    await this.publishToolStarted(context.threadId, context.turnId, toolCall, parsedArguments);
    const execution = await this.options.collaborationCoordinator().execute(toolCall.name, parsedArguments, context);
    await this.publishCollaborationItem(context.threadId, context.turnId, toolCall.id, execution.collabToolCall, 'in_progress');
    await this.publishCollaborationItem(context.threadId, context.turnId, toolCall.id, {
      ...execution.collabToolCall,
      agentStatus: execution.collabToolCall.agentStatus ?? 'completed',
    }, 'completed');
    await this.publishToolCompleted(context.threadId, context.turnId, toolCall, parsedArguments, 'success', execution.preview, {
      data: execution.data,
      resultPreview: execution.preview,
      startedAtMs,
    });
    return { content: execution.content };
  }

  private async runGoalToolCall(toolCall: RuntimeToolCall, parsedArguments: unknown, context: RuntimeToolExecutionContext): Promise<{ content: string }> {
    const startedAtMs = this.options.clock.now().getTime();
    await this.publishToolStarted(context.threadId, context.turnId, toolCall, parsedArguments);
    const execution = await this.options.goalCoordinator().execute(toolCall.name, parsedArguments, context);
    await this.publishToolCompleted(context.threadId, context.turnId, toolCall, parsedArguments, 'success', execution.preview, {
      data: execution.data,
      resultPreview: execution.preview,
      startedAtMs,
    });
    return { content: execution.content };
  }

  private async publishCollaborationItem(threadId: string, turnId: string, itemId: string, collabToolCall: RuntimeCollabToolCall, status: NonNullable<RuntimeStreamItem['status']>): Promise<void> {
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: status === 'completed' || status === 'failed' || status === 'cancelled' ? 'item.completed' : 'item.started',
      createdAt: this.options.clock.now().toISOString(),
      payload: {
        item: {
          id: itemId,
          kind: 'collab_tool_call',
          status,
          collabToolCall,
        },
      },
    });
  }

  cleanupTurn(turnId: string): void {
    this.toolApprovalStore.clearTurn(turnId);
  }

  /**
   * 将工具执行结果写成 role=tool 的消息，供下一轮模型继续读取。
   *
   * @param threadId 目标线程 ID。
   * @param turnId 当前 turn ID。
   * @param toolCall 对应的模型工具调用。
   * @param content 工具返回给模型的文本内容。
   * @param attachments 工具返回给模型的图片等附件。
   */
  private async publishToolMessage(
    threadId: string,
    turnId: string,
    toolCall: RuntimeToolCall,
    content: string,
    attachments?: RuntimeMessage['attachments'],
  ): Promise<RuntimeMessage> {
    const message: RuntimeMessage = {
      id: this.options.ids.id('msg'),
      turnId,
      role: 'tool',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content,
      ...(attachments?.length ? { attachments: attachments.map((attachment) => ({ ...attachment })) } : {}),
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
    };
    await this.options.publishMessage(threadId, turnId, message);
    return message;
  }

  /**
   * 发布 tool.started 事件，提前展示工具名、参数和可选预览。
   *
   * @param threadId 目标线程 ID。
   * @param turnId 当前 turn ID。
   * @param toolCall 对应的模型工具调用。
   * @param parsedArguments 已解析的工具参数。
   * @param resultPreview 工具执行前可展示的结果预览。
   */
  private async publishToolStarted(threadId: string, turnId: string, toolCall: RuntimeToolCall, parsedArguments: unknown, resultPreview?: string, plugin?: RuntimePluginReference): Promise<void> {
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'tool.started',
      createdAt: this.options.clock.now().toISOString(),
      payload: {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        argumentsPreview: previewArguments(parsedArguments),
        resultPreview,
        ...(plugin ? { plugin: { ...plugin } } : {}),
      },
    });
  }

  /**
   * 根据模型流式输出的 tool_call_delta 发布限频后的渐进式工具预览。
   *
   * @param announcedToolPreviews 已发布预览的签名缓存。
   * @param call 本次模型输出的工具调用增量。
   * @param partialToolCalls 已合并的部分工具调用缓存。
   * @param threadId 目标线程 ID。
   * @param toolRouter 当前 sampling step 的工具路由器。
   * @param turnId 当前 turn ID。
   */
  async publishToolCallDeltaPreview({ announcedToolPreviews, call, partialToolCalls, threadId, toolRouter, turnId }: { announcedToolPreviews: Map<string, ToolPreviewAnnouncement>; call: RuntimeToolCallDeltaLike; partialToolCalls: Map<string, RuntimeToolCall>; threadId: string; toolRouter: RuntimeToolRouter | null; turnId: string }): Promise<void> {
    if (!toolRouter) return;
    const id = call.id || `tool_call_${partialToolCalls.size}`;
    const current = partialToolCalls.get(id) ?? { id, name: '', arguments: '' };
    // 部分模型会分片输出 arguments；这里尽量合并成可预览的渐进工具调用。
    const next = {
      id,
      name: call.name || current.name,
      arguments: mergeToolArgumentDelta(current.arguments, call.argumentsDelta),
    };
    partialToolCalls.set(id, next);
    if (!next.name) return;
    if (!toolRouter.hasTool(next.name)) return;

    const previous = announcedToolPreviews.get(id);
    const argumentsLength = next.arguments.length;
    // 文件内容可能逐 token 输出。先按参数增长量限频，避免每个 token 都计算 diff、落盘和触发 renderer 更新。
    if (previous && argumentsLength >= previous.argumentsLength
      && argumentsLength - previous.argumentsLength < TOOL_PREVIEW_ARGUMENT_GROWTH_THRESHOLD) return;

    const preview = await toolRouter.previewPartialToolCall(next.name, next.arguments);
    // 单独的左花括号不包含有用的目标或进度信息。等待首次主机预览，可以让 file_path
    // 之类的路径立即显示，而不是被后续 1 KiB 的节流窗口遮蔽。
    if (!previous && !preview && argumentsLength < TOOL_PREVIEW_ARGUMENT_GROWTH_THRESHOLD) return;
    const argumentsPreview = preview?.argumentsPreview ?? previewPartialArguments(next.arguments);
    const resultPreview = preview?.resultPreview;
    const signature = JSON.stringify({ name: next.name, argumentsPreview, resultPreview });
    // 预览内容和参数进度都没变化时不重复发布，避免 UI 闪烁和 toolRun 重复合并。
    if (previous?.signature === signature && previous.argumentsLength === argumentsLength) return;
    announcedToolPreviews.set(id, { argumentsLength, signature });
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'tool.preview',
      createdAt: this.options.clock.now().toISOString(),
      payload: {
        toolCallId: id,
        toolName: next.name,
        argumentsPreview,
        argumentsLength,
        resultPreview,
      },
    });
  }

  /**
   * 发布工具运行过程中的流式输出片段。
   *
   * @param threadId 目标线程 ID。
   * @param turnId 当前 turn ID。
   * @param toolCall 对应的模型工具调用。
   * @param delta 工具输出流片段和来源信息。
   */
  private async publishToolOutputDelta(threadId: string, turnId: string, toolCall: RuntimeToolCall, delta: ToolOutputDelta): Promise<void> {
    if (!delta.delta) return;
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'tool.output_delta',
      createdAt: this.options.clock.now().toISOString(),
      payload: {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        delta: delta.delta,
        stream: delta.stream,
        processId: delta.processId,
      },
    });
  }

  async publishHookStarted(threadId: string, turnId: string, run: RuntimeHookRun): Promise<void> {
    const createdAt = this.options.clock.now().toISOString();
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'hook.started',
      createdAt,
      payload: {
        ...run,
        startedAt: run.startedAt ?? createdAt,
        status: 'running',
      },
    });
  }

  async publishHookCompleted(threadId: string, turnId: string, run: RuntimeHookRun): Promise<void> {
    const createdAt = this.options.clock.now().toISOString();
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'hook.completed',
      createdAt,
      payload: {
        ...run,
        completedAt: run.completedAt ?? createdAt,
      },
    });
  }

  /**
   * 发布 tool.completed 事件，记录最终状态、预览、数据和耗时。
   *
   * @param threadId 目标线程 ID。
   * @param turnId 当前 turn ID。
   * @param toolCall 对应的模型工具调用。
   * @param parsedArguments 已解析的工具参数。
   * @param status 工具最终状态。
   * @param content 工具返回内容或错误文案。
   * @param metadata 可选数据、预览和开始时间。
   */
  private async publishToolCompleted(threadId: string, turnId: string, toolCall: RuntimeToolCall, parsedArguments: unknown, status: 'success' | 'error' | 'rejected', content: string, metadata: { data?: unknown; resultPreview?: string; startedAtMs?: number } = {}): Promise<void> {
    const completedAt = this.options.clock.now();
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'tool.completed',
      createdAt: completedAt.toISOString(),
      payload: {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        status,
        content: previewToolContent(content),
        argumentsPreview: previewArguments(parsedArguments),
        // 结构化预览必须保持可解析。文本截断可能从令牌中间切断 JSON，并静默移除
        // 聊天区和审查投影所需的文件路径或变更计数。
        resultPreview: metadata.resultPreview,
        data: metadata.data,
        durationMs: metadata.startedAtMs === undefined ? undefined : Math.max(0, completedAt.getTime() - metadata.startedAtMs),
      },
    });
    // The completed event is the authoritative terminal state. A secondary diff
    // projection must never make the caller publish a conflicting second state.
    await this.publishTurnDiffFromToolPreview(threadId, turnId, toolCall.name, status, metadata.resultPreview).catch(() => undefined);
  }

  private async publishTurnDiffFromToolPreview(threadId: string, turnId: string, toolName: string, status: 'success' | 'error' | 'rejected', resultPreview?: string): Promise<void> {
    if (status !== 'success' || !FILE_MUTATION_TOOL_NAMES.has(toolName)) return;
    const unifiedDiff = unifiedDiffFromToolPreview(resultPreview);
    if (!unifiedDiff) return;
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.diff',
      createdAt: this.options.clock.now().toISOString(),
      payload: { unifiedDiff },
    });
  }

  toolOrchestratorFor(context: RuntimeToolExecutionContext, runtimeConfig: RuntimeConfigState | null | undefined): ToolOrchestrator | null {
    if (!this.options.toolHost) return null;
    return new ToolOrchestrator({
      toolHost: this.options.toolHost,
      approvalGate: this.options.approvalGate,
      approvalStore: this.toolApprovalStore,
      policyAmendmentStore: this.options.policyAmendmentStore,
      persistentToolApprovalStore: this.options.persistentToolApprovalStore,
      hookRunner: createRuntimeToolHookRunner(runtimeConfig),
      clock: this.options.clock,
      events: {
        publishToolStarted: (toolCall, parsedArguments, resultPreview, plugin) => this.publishToolStarted(context.threadId, context.turnId, toolCall, parsedArguments, resultPreview, plugin),
        publishToolCompleted: (toolCall, parsedArguments, status, content, metadata = {}) => this.publishToolCompleted(context.threadId, context.turnId, toolCall, parsedArguments, status, content, metadata),
        publishToolOutputDelta: (toolCall, delta) => this.publishToolOutputDelta(context.threadId, context.turnId, toolCall, delta),
        publishHookStarted: (run) => this.publishHookStarted(context.threadId, context.turnId, run),
        publishHookCompleted: (run) => this.publishHookCompleted(context.threadId, context.turnId, run),
        publishApprovalRequested: (approval) => this.publishApprovalRequested(context, approval),
        publishApprovalResolved: (approvalId, decision, message, createdAt) => this.publishApprovalResolved(context, approvalId, decision, message, createdAt),
      },
    });
  }

  private async publishApprovalRequested(context: RuntimeToolExecutionContext, approval: RuntimeApprovalRequest): Promise<void> {
    await this.options.appendEvent(context.threadId, {
      id: this.options.ids.id('event'),
      threadId: context.threadId,
      turnId: context.turnId,
      type: 'approval.requested',
      createdAt: approval.createdAt,
      payload: { approval },
    });
  }

  private async publishApprovalResolved(context: RuntimeToolExecutionContext, approvalId: string, decision: RuntimeApprovalDecision, message?: string, createdAt?: string): Promise<void> {
    await this.options.appendEvent(context.threadId, {
      id: this.options.ids.id('event'),
      threadId: context.threadId,
      turnId: context.turnId,
      type: 'approval.resolved',
      createdAt: createdAt ?? this.options.clock.now().toISOString(),
      payload: {
        approvalId,
        decision,
        message,
      },
    });
  }
}
