import type { RuntimeConfigState, RuntimeEvent, RuntimeMessage, RuntimeThread, RuntimeCollabToolName } from '@setsuna-desktop/contracts';
import type { FeatureProjectionStore } from '@setsuna-desktop/feature-core/runtime';
import {
  collaborationSpawnResultEnvelope, cloneCollaborationState, isTerminalCollaborationTaskStatus,
  type CollaborationControl, type CollaborationExecution, type CollaborationRuntimeHost, type CollaborationState,
  type CollaborationStateSnapshot, type CollaborationTask, type CollaborationToolExecutionContext,
  type CollaborationToolExecutionResult,
  type CollaborationAgentSettings, type CollaborationUserAction, type CollaborationActionResult,
  type CollaborationSubagentTurnInput, defaultCollaborationAgentSettings, collaborationModelSelectionCodec, agentReasoningEffort,
  resolveCollaborationRoleText, collaborationAgentAvatarCodec,
} from '../contracts/index.js';
import { CollaborationThreadNotFoundError } from './runtime-collaboration-errors.js';
import {
  avatarSeedForThread, collaborationDisplayName, collaborationTimeoutMs, collaborationTitle,
  errorMessage, optionalString, recordInput, requiredString,
} from './collaboration-input.js';
import { CollaborationLedger } from './collaboration-ledger.js';
import { childAgentOutput, executionOutput, resultPage, resultSummary, COLLABORATION_RESULT_PAGE_CHARS } from './collaboration-results.js';
import { buildCollaborationHandoff, parentTurnContext } from './collaboration-handoff.js';
import { collaborationToolDefinitions, collaborationToolsEnabled, isCollaborationToolName } from './collaboration-tools.js';
import { waitForCollaborationActivity, waitForTaskSettlement } from './collaboration-wait.js';

export { collaborationToolDefinitions, collaborationToolsEnabled, isCollaborationToolName, COLLABORATION_TOOL_DEFINITIONS } from './collaboration-tools.js';

export type RuntimeCollaborationCoordinatorOptions = Readonly<{
  host: CollaborationRuntimeHost;
  onProjectionFailure?(threadId: string, error: unknown): void;
  projection: FeatureProjectionStore<CollaborationState>;
  agentSettings?(): Promise<CollaborationAgentSettings>;
}>;

export function isCollaborationChildLifecycleEvent(event: RuntimeEvent): boolean {
  if (event.type === 'turn.started' || event.type === 'turn.completed' || event.type === 'turn.cancelled') {
    return event.payload.taskKind === 'subagent';
  }
  return event.type === 'approval.requested' || event.type === 'approval.resolved' || event.type === 'runtime.error';
}

/** Feature-owned dispatch, ownership checks, and result delivery; Core only supplies narrow ports. */
export class RuntimeCollaborationCoordinator implements CollaborationControl {
  readonly available = true;
  private readonly ledger: CollaborationLedger;
  private readonly dispatches = new Map<string, Promise<unknown>>();
  private stopped = false;

  constructor(private readonly options: RuntimeCollaborationCoordinatorOptions) {
    this.ledger = new CollaborationLedger(options.host, options.projection);
  }

  shutdown(): void { this.stopped = true; }
  enabled(config: RuntimeConfigState | null | undefined): boolean { return !this.stopped && collaborationToolsEnabled(config); }
  toolDefinitions(config: RuntimeConfigState | null | undefined) {
    return this.enabled(config) ? collaborationToolDefinitions(config?.desktopSettings?.interfaceLanguage ?? 'zh-CN') : [];
  }
  isToolName(name: string): boolean { return isCollaborationToolName(name); }

  async readState(threadId: string): Promise<CollaborationStateSnapshot> {
    if (!await this.options.host.getThread(threadId)) throw new CollaborationThreadNotFoundError(threadId);
    await this.reconcileInterruptedTasks(threadId);
    const snapshot = await this.ledger.read(threadId);
    return Object.freeze({ state: cloneCollaborationState(snapshot.state), throughSeq: snapshot.throughSeq });
  }

  async reconcileInterruptedTasks(parentThreadId: string): Promise<void> {
    if (this.stopped) return;
    try { await this.ledger.reconcile(parentThreadId); }
    catch (error) { this.options.onProjectionFailure?.(parentThreadId, error); throw error; }
  }

  async authorizationContext(childThreadId: string, turnId: string): Promise<RuntimeThread | null> {
    const child = await this.options.host.getThread(childThreadId);
    if (!child?.parentThreadId || child.kind === 'side') return null;
    const { state } = await this.ledger.read(child.parentThreadId);
    const task = state.tasks.find((task) => task.childThreadId === childThreadId);
    const execution = state.executions.find((entry) => entry.turnId === turnId && entry.taskId === task?.id);
    if (!execution?.parentTurnId) return null;
    const parent = await this.options.host.getThread(child.parentThreadId);
    return parent && !parent.parentThreadId && parent.kind !== 'side' ? parentTurnContext(parent, execution.parentTurnId) : null;
  }

  /** Authenticated renderer actions have user provenance; model tools cannot call this path. */
  async act(input: CollaborationUserAction, signal: AbortSignal): Promise<CollaborationActionResult> {
    return this.dispatch(input.threadId, async () => {
      const context = { threadId: input.threadId, turnId: '', signal };
      this.assertRunning(context);
      await this.requireRoot(input.threadId);
      const child = await this.requireDirectChild(input.childThreadId, context);
      const active = this.options.host.activeTask(child.id);
      const runningTurnId = active?.acceptingInput === false ? null : active?.turnId ?? null;
      if (runningTurnId !== input.expectedTurnId) throw new Error('The child execution changed. Refresh before retrying.');
      if (input.action === 'send') {
        if (!active || active.acceptingInput === false) throw new Error('Child is idle. Resume it to send a new instruction.');
        await this.options.host.steerTurn(child.id, input.content!, active.turnId);
        return { turnId: active.turnId };
      }
      if (input.action === 'close' || input.action === 'interrupt') {
        await (input.action === 'close' ? this.closeAgent({ thread_id: child.id }, context) : this.interruptAgent({ thread_id: child.id }, context));
        return { turnId: active?.turnId ?? null };
      }
      if (active?.acceptingInput !== false && active) throw new Error('Child is already running. Send a supplementary instruction instead.');
      if (active?.done) await waitForTaskSettlement(active.done, signal);
      const { state } = await this.readState(input.threadId);
      const task = state.tasks.find((task) => task.childThreadId === child.id);
      if (!task) throw new Error('Child has no collaboration task.');
      const previous = state.executions.filter((entry) => entry.taskId === task.id).at(-1);
      // A human may revisit an old child while the parent is doing unrelated work.
      // Preserve the proved task origin instead of borrowing the currently active parent's authority.
      const parentTurnId = previous?.parentTurnId;
      const execution = this.newExecution(task.id, this.options.host.id('turn'), parentTurnId);
      await this.startExecution(task, execution, input.content!, context, false, { userInitiated: true });
      return { turnId: execution.turnId };
    });
  }

  async pendingChildren(parentThreadId: string): Promise<{ active: number; total: number }> {
    const pending = await this.pendingExecutions(parentThreadId);
    return { active: pending.filter((entry) => !isTerminalCollaborationTaskStatus(entry.status)).length, total: pending.length };
  }

  async collectPendingChildren(
    parentThreadId: string,
    parentTurnId: string,
    signal: AbortSignal,
    options: Readonly<{ wait?: boolean }> = {},
  ): Promise<RuntimeMessage[]> {
    while (true) {
      signal.throwIfAborted();
      // Capture the revision before reading so completion during the read cannot be missed.
      const revision = this.ledger.revision(parentThreadId);
      const pending = await this.pendingExecutions(parentThreadId);
      const ready = pending.filter((entry) => isTerminalCollaborationTaskStatus(entry.status));
      if (ready.length) return this.ledger.deliver(parentThreadId, parentTurnId, ready.map((entry) => entry.turnId), signal);
      if (!pending.length || options.wait === false) return [];
      const { state } = await this.ledger.read(parentThreadId);
      const completions = pending.flatMap((execution) => {
        const task = state.tasks.find((candidate) => candidate.id === execution.taskId)!;
        const active = this.options.host.activeTask(task.childThreadId);
        return active?.turnId === execution.turnId && active.done ? [active.done] : [];
      });
      const reason = await waitForCollaborationActivity(this.options.host, { threadId: parentThreadId, turnId: parentTurnId, signal }, completions,
        undefined, (subscription) => this.ledger.waitForChange(parentThreadId, revision, subscription));
      if (reason === 'input') return [];
      // Bookkeeping and approval changes alone do not justify another model request.
    }
  }

  async cancelChildren(parentThreadId: string, parentTurnId: string): Promise<void> {
    const { state } = await this.ledger.read(parentThreadId);
    await Promise.all(state.executions.filter((entry) => entry.parentTurnId === parentTurnId
      && !isTerminalCollaborationTaskStatus(entry.status)).map(async (execution) => {
      const task = state.tasks.find((candidate) => candidate.id === execution.taskId)!;
      const active = this.options.host.activeTask(task.childThreadId);
      // A reused child may already belong to a newer parent turn; never cancel that run.
      if (active?.turnId === execution.turnId) await this.options.host.cancelTurn(task.childThreadId, execution.turnId);
      await this.ledger.update(parentThreadId, execution.turnId, { status: 'cancelled', error: 'Owning parent turn ended.' });
    }));
  }

  async execute(name: string, argumentsValue: unknown, context: CollaborationToolExecutionContext): Promise<CollaborationToolExecutionResult> {
    this.assertRunning(context);
    const input = recordInput(argumentsValue);
    if (name === 'spawn_agent' || name === 'resume_agent' || name === 'interrupt_agent' || name === 'close_agent') {
      // Keep identity and execution bookkeeping ordered across concurrent spawn/resume calls.
      return this.dispatch(context.threadId, async () => {
        this.assertRunning(context);
        if (name === 'spawn_agent') return this.spawnAgent(input, context);
        if (name === 'resume_agent') return this.resumeAgent(input, context);
        return name === 'interrupt_agent' ? this.interruptAgent(input, context) : this.closeAgent(input, context);
      });
    }
    if (name === 'send_input') return this.sendInput(input, context);
    if (name === 'wait') return this.waitForAgent(input, context);
    if (name === 'read_agent_result') return this.readAgentResult(input, context);
    if (name === 'list_agent_profiles') {
      await this.requireRoot(context.threadId);
      const settings = await this.agentSettings();
      return toolResult('list_agent_profiles', context.threadId, context.threadId, {
        defaults: { model: settings.model, reasoningEffort: settings.reasoningEffort },
        roles: settings.roles.map((role) => ({ name: role.name, model: role.model, reasoningEffort: role.reasoningEffort,
          description: resolveCollaborationRoleText(role, context.interfaceLanguage ?? 'zh-CN').description })),
        availableModels: await this.options.host.listModels(), status: 'completed',
      });
    }
    throw new Error(`Unknown collaboration tool: ${name}`);
  }

  async observeCoreEvent(event: RuntimeEvent): Promise<void> {
    if (this.stopped || !isCollaborationChildLifecycleEvent(event) || !event.turnId) return;
    const child = await this.options.host.getThread(event.threadId);
    if (!child?.parentThreadId || child.kind === 'side') return;
    const parentThreadId = child.parentThreadId;
    if (!await this.options.host.getThread(parentThreadId)) return;
    const { state } = await this.ledger.read(parentThreadId);
    const task = state.tasks.find((candidate) => candidate.childThreadId === child.id);
    if (!task) return;
    let execution = state.executions.find((candidate) => candidate.turnId === event.turnId);
    if (!execution && event.type === 'turn.started') {
      // Non-tool resume paths remain represented, without inventing ownership of an active parent.
      execution = this.newExecution(task.id, event.turnId);
      await this.ledger.register(parentThreadId, task, execution, false);
    }
    if (!execution || isTerminalCollaborationTaskStatus(execution.status)) return;
    if (event.type === 'approval.resolved') {
      const pending = child.messages.some((message) => message.turnId === event.turnId && message.toolRuns?.some((run) => run.approvalStatus === 'pending'));
      await this.ledger.update(parentThreadId, event.turnId, { status: pending ? 'waiting_approval' : 'running' });
    } else if (event.type === 'turn.started') {
      await this.ledger.update(parentThreadId, event.turnId, { status: 'running' });
    } else if (event.type === 'approval.requested') {
      await this.ledger.update(parentThreadId, event.turnId, { status: 'waiting_approval' });
    } else if (event.type === 'turn.completed') {
      const output = childAgentOutput(child, event.turnId);
      await this.ledger.update(parentThreadId, event.turnId, { status: 'completed', ...(output ? { resultPreview: output.slice(0, 240) } : {}) });
    } else if (event.type === 'turn.cancelled') {
      await this.ledger.update(parentThreadId, event.turnId, { status: 'cancelled', ...(event.payload.reason ? { error: event.payload.reason } : {}) });
    } else if (event.type === 'runtime.error') {
      await this.ledger.update(parentThreadId, event.turnId, { status: 'failed', error: event.payload.message });
    }
  }

  private async spawnAgent(input: Record<string, unknown>, context: CollaborationToolExecutionContext): Promise<CollaborationToolExecutionResult> {
    const prompt = requiredString(input, ['prompt', 'task', 'input'], 'prompt');
    if (prompt.length > 32_000) throw new Error('Child task prompt exceeds 32000 characters.');
    const contextMode = input.context_mode ?? 'fresh';
    if (contextMode !== 'fresh' && contextMode !== 'snapshot') throw new Error('context_mode must be fresh or snapshot.');
    const parent = await this.requireRoot(context.threadId);
    const settings = await this.agentSettings();
    const roleName = optionalString(input, ['role']) || 'default';
    const role = settings.roles.find((role) => role.name === roleName);
    if (!role) throw new Error(`Unknown agent role: ${roleName}. Use list_agent_profiles.`);
    const roleText = resolveCollaborationRoleText(role, context.interfaceLanguage ?? 'zh-CN');
    const configuration = {
      ...await this.options.host.resolveAgentConfiguration(parent, {
        role: role.name, instructions: roleText.instructions,
        model: input.model !== undefined ? collaborationModelSelectionCodec.parse(input.model) : role.model ?? settings.model,
        reasoningEffort: input.reasoning_effort !== undefined ? agentReasoningEffort(input.reasoning_effort) : role.reasoningEffort ?? settings.reasoningEffort,
      }),
      description: roleText.description,
    };
    const { state } = await this.readState(context.threadId);
    this.assertRunning(context);
    const child = await this.options.host.createThread({
      title: collaborationTitle(input, prompt), projectId: parent.projectId, workspaceId: parent.workspaceId,
      parentThreadId: parent.id, memoryMode: parent.memoryMode, modelBinding: configuration.modelBinding,
    });
    const createdAt = this.options.host.now().toISOString();
    const modelIdentity = { displayName: collaborationDisplayName(input, state.tasks), avatarSeed: avatarSeedForThread(child.id) };
    // Capture appearance for every UI projection, without sending image bytes to the model.
    const identity = { ...modelIdentity, ...(role.avatar ? { avatar: collaborationAgentAvatarCodec.parse(role.avatar) } : {}) };
    const task: CollaborationTask = {
      id: this.options.host.id('task'), childThreadId: child.id, title: child.title, objective: prompt,
      identity, configuration, status: 'queued', createdAt, updatedAt: createdAt,
    };
    const execution = this.newExecution(task.id, this.options.host.id('turn'), context.turnId);
    const handoff = buildCollaborationHandoff(parent, context.turnId, execution.turnId, createdAt, contextMode);
    await this.options.host.retainAttachments(parent.id, child.id, handoff.attachments);
    await this.startExecution(task, execution, prompt, context, true, handoff);
    const modelData = {
      tool: 'spawn_agent', senderThreadId: parent.id, childThreadId: child.id, newThreadId: child.id,
      taskId: task.id, turnId: execution.turnId, title: task.title, objective: prompt, identity: modelIdentity, status: 'running', contextMode,
      role: configuration.role, model: configuration.modelBinding, thinking: configuration.thinking, reasoningEffort: configuration.reasoningEffort,
    };
    return {
      collabToolCall: { tool: 'spawn_agent', senderThreadId: parent.id, newThreadId: child.id, taskId: task.id, prompt, agentStatus: 'running' },
      content: JSON.stringify(modelData),
      data: { ...collaborationSpawnResultEnvelope({ childThreadId: child.id, identity, objective: prompt, parentThreadId: parent.id,
        status: 'running', taskId: task.id, title: task.title, turnId: execution.turnId }) },
      preview: `Spawned child agent ${identity.displayName}.`,
    };
  }

  private async resumeAgent(input: Record<string, unknown>, context: CollaborationToolExecutionContext): Promise<CollaborationToolExecutionResult> {
    const receiver = await this.requireDirectChild(receiverId(input), context);
    await this.requireRoot(context.threadId);
    const content = mailboxContent(input);
    let active = this.options.host.activeTask(receiver.id);
    if (active && active.acceptingInput !== false) {
      const delivered = await this.deliverInput(receiver, content, context, 'resume_agent');
      if (typeof delivered.data.turnId === 'string') return delivered;
      // The receiver can close input admission during delivery. A queued follow-up still
      // needs a new execution; returning here would silently leave that request idle.
      active = this.options.host.activeTask(receiver.id);
    }
    if (active?.done) await waitForTaskSettlement(active.done, context.signal);
    this.assertRunning(context);
    const { state } = await this.readState(context.threadId);
    const task = state.tasks.find((candidate) => candidate.childThreadId === receiver.id);
    if (!task) throw new Error('Child has no collaboration task.');
    const execution = this.newExecution(task.id, this.options.host.id('turn'), context.turnId);
    const parent = await this.requireRoot(context.threadId);
    const handoff = buildCollaborationHandoff(parent, context.turnId, execution.turnId, this.options.host.now().toISOString(), 'fresh');
    await this.options.host.retainAttachments(parent.id, receiver.id, handoff.attachments);
    await this.startExecution(task, execution, content, context, false, handoff);
    return toolResult('resume_agent', context.threadId, receiver.id, { turnId: execution.turnId, status: 'running', queued: false });
  }

  private async startExecution(
    task: CollaborationTask, execution: CollaborationExecution, prompt: string, context: CollaborationToolExecutionContext,
    newTask: boolean, handoff: Partial<CollaborationSubagentTurnInput> = {},
  ): Promise<void> {
    this.ledger.starting.add(execution.turnId);
    try {
      await this.ledger.register(context.threadId, task, execution, newTask);
      this.assertRunning(context);
      const started = await this.options.host.startTurn(task.childThreadId, {
        ...handoff, name: task.identity.displayName, prompt, title: task.title, turnId: execution.turnId, configuration: task.configuration,
      }, { unattended: context.unattended });
      if (started.turnId !== execution.turnId) {
        await this.options.host.cancelTurn(task.childThreadId, started.turnId);
        throw new Error('Child turn does not match its reserved execution.');
      }
      if (context.signal.aborted || this.stopped) {
        await this.options.host.cancelTurn(task.childThreadId, execution.turnId);
        this.assertRunning(context);
      }
      await this.ledger.update(context.threadId, execution.turnId, { status: 'running' });
    } catch (error) {
      await this.ledger.update(context.threadId, execution.turnId, {
        status: context.signal.aborted || this.stopped ? 'cancelled' : 'failed', error: errorMessage(error),
      });
      throw error;
    } finally { this.ledger.starting.delete(execution.turnId); }
  }

  private async sendInput(input: Record<string, unknown>, context: CollaborationToolExecutionContext): Promise<CollaborationToolExecutionResult> {
    const receiver = await this.options.host.getThread(receiverId(input));
    const sender = await this.options.host.getThread(context.threadId);
    if (!receiver || !sender || sender.kind === 'side' || receiver.kind === 'side') throw new Error('Collaboration endpoint is unavailable.');
    if (sender.parentThreadId === receiver.id) {
      const { state } = await this.ledger.read(receiver.id);
      const execution = state.executions.find((entry) => entry.turnId === context.turnId
        && state.tasks.some((task) => task.id === entry.taskId && task.childThreadId === sender.id));
      if (!execution || isTerminalCollaborationTaskStatus(execution.status)) throw new Error('Child execution is no longer active.');
      const parentActive = this.options.host.activeTask(receiver.id);
      if (parentActive && parentActive.turnId !== execution.parentTurnId) throw new Error('The owning parent turn is no longer active.');
      return this.deliverInput(receiver, mailboxContent(input), context, 'send_input', parentActive?.turnId);
    }
    await this.requireDirectChild(receiver.id, context);
    return this.deliverInput(receiver, mailboxContent(input), context, 'send_input');
  }

  private async deliverInput(receiver: RuntimeThread, content: string, context: CollaborationToolExecutionContext, name: 'send_input' | 'resume_agent', expectedTurnId?: string) {
    this.assertRunning(context);
    const delivered = await this.options.host.deliverMailbox(receiver.id, {
      content, deliveryMode: 'queue_only', fromAgentId: context.threadId, fromThreadId: context.threadId,
      toAgentId: receiver.id, triggerTurn: false, ...(expectedTurnId ? { expectedTurnId } : {}),
    }, { unattended: context.unattended });
    return toolResult(name, context.threadId, receiver.id, {
      turnId: delivered.turnId, queued: delivered.queued ?? false, status: delivered.turnId ? 'delivered' : 'queued',
    });
  }

  private async waitForAgent(input: Record<string, unknown>, context: CollaborationToolExecutionContext): Promise<CollaborationToolExecutionResult> {
    const id = receiverId(input);
    const child = await this.requireDirectChild(id, context);
    const timeoutMs = collaborationTimeoutMs(input);
    const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
    let wakeReason: 'completion' | 'input' | 'timeout' = 'completion';
    while (true) {
      this.assertRunning(context);
      const revision = this.ledger.revision(context.threadId);
      // Retain the completion handle if cleanup finishes while the ledger is being read.
      const active = this.options.host.activeTask(id);
      const { state } = await this.readState(context.threadId);
      const task = state.tasks.find((candidate) => candidate.childThreadId === id);
      const execution = task ? state.executions.filter((entry) => entry.taskId === task.id).at(-1) : undefined;
      const status = execution?.status ?? (active ? 'running' : 'interrupted');
      if (execution && task && isTerminalCollaborationTaskStatus(status)) {
        const resultThread = await this.options.host.getThread(child.id);
        await this.ledger.deliver(context.threadId, context.turnId, [execution.turnId], context.signal);
        return toolResult('wait', context.threadId, id, {
          ...resultSummary(resultThread, task, execution), timedOut: false, interruptedByInput: wakeReason === 'input',
        });
      }
      // A different child may finish first; the next sampling boundary will deliver its result.
      const interruptedByResult = state.executions.some((entry) => entry.delivery === 'pending' && isTerminalCollaborationTaskStatus(entry.status));
      if ((!execution && !active?.done) || wakeReason !== 'completion' || interruptedByResult) {
        return toolResult('wait', context.threadId, id, {
          status, timedOut: wakeReason === 'timeout', interruptedByInput: wakeReason === 'input', interruptedByResult,
        });
      }
      wakeReason = await waitForCollaborationActivity(this.options.host, context, active?.done ? [active.done] : [],
        deadline === undefined ? undefined : Math.max(0, deadline - Date.now()),
        (subscription) => this.ledger.waitForChange(context.threadId, revision, subscription));
    }
  }

  private async readAgentResult(input: Record<string, unknown>, context: CollaborationToolExecutionContext): Promise<CollaborationToolExecutionResult> {
    const child = await this.requireDirectChild(receiverId(input), context);
    const turnId = requiredString(input, ['turn_id'], 'turn_id');
    const { state } = await this.readState(context.threadId);
    const execution = state.executions.find((entry) => entry.turnId === turnId
      && state.tasks.some((task) => task.id === entry.taskId && task.childThreadId === child.id));
    if (!execution || !isTerminalCollaborationTaskStatus(execution.status)) throw new Error('A terminal child execution is required.');
    const offset = input.offset ?? 0;
    const limit = input.limit ?? COLLABORATION_RESULT_PAGE_CHARS;
    if (!Number.isSafeInteger(offset) || (offset as number) < 0 || !Number.isSafeInteger(limit)
      || (limit as number) < 2 || (limit as number) > COLLABORATION_RESULT_PAGE_CHARS) throw new Error('Invalid result page range.');
    const output = executionOutput(child, execution);
    if ((offset as number) > output.length) throw new Error('Result offset exceeds output length.');
    return toolResult('read_agent_result', context.threadId, child.id, { turnId, status: execution.status, ...resultPage(output, offset as number, limit as number) });
  }

  private async closeAgent(input: Record<string, unknown>, context: CollaborationToolExecutionContext): Promise<CollaborationToolExecutionResult> {
    const child = await this.requireDirectChild(receiverId(input), context);
    const active = this.options.host.activeTask(child.id);
    const { state } = await this.readState(context.threadId);
    const task = state.tasks.find((candidate) => candidate.childThreadId === child.id);
    const cancelled = active ? await this.options.host.cancelTurn(child.id, active.turnId) : false;
    for (const execution of state.executions.filter((entry) => entry.taskId === task?.id && entry.delivery === 'pending')) {
      await this.ledger.update(context.threadId, execution.turnId, { delivery: 'dismissed' });
    }
    return toolResult('close_agent', context.threadId, child.id, { cancelled, status: cancelled ? 'cancelled' : 'closed', reason: optionalString(input, ['reason']) });
  }

  private async interruptAgent(input: Record<string, unknown>, context: CollaborationToolExecutionContext): Promise<CollaborationToolExecutionResult> {
    const child = await this.requireDirectChild(receiverId(input), context);
    const active = this.options.host.activeTask(child.id);
    if (active) {
      // Persist intent first: cancellation events must not turn an intentional interruption into a dismissal.
      await this.ledger.update(context.threadId, active.turnId, { status: 'interrupted' });
      await this.options.host.cancelTurn(child.id, active.turnId);
    }
    return toolResult('interrupt_agent', context.threadId, child.id, { turnId: active?.turnId ?? null, status: active ? 'interrupted' : 'idle' });
  }

  private agentSettings(): Promise<CollaborationAgentSettings> {
    return this.options.agentSettings?.() ?? Promise.resolve(defaultCollaborationAgentSettings());
  }

  private async pendingExecutions(parentThreadId: string): Promise<readonly CollaborationExecution[]> {
    await this.reconcileInterruptedTasks(parentThreadId);
    return (await this.ledger.read(parentThreadId)).state.executions.filter((entry) => entry.delivery === 'pending');
  }

  private async requireRoot(threadId: string): Promise<RuntimeThread> {
    const thread = await this.options.host.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    if (thread.parentThreadId || thread.kind === 'side') throw new Error('Only a root thread can spawn or resume collaboration agents.');
    return thread;
  }

  private async requireDirectChild(id: string, context: CollaborationToolExecutionContext): Promise<RuntimeThread> {
    const child = await this.options.host.getThread(id);
    if (!child || child.kind === 'side' || child.parentThreadId !== context.threadId) throw new Error(`Thread ${id} is not a direct child of thread ${context.threadId}.`);
    return child;
  }

  private newExecution(taskId: string, turnId: string, parentTurnId?: string): CollaborationExecution {
    const createdAt = this.options.host.now().toISOString();
    return { taskId, turnId, parentTurnId, status: 'queued', delivery: 'pending', createdAt, updatedAt: createdAt };
  }

  private assertRunning(context: CollaborationToolExecutionContext): void {
    context.signal.throwIfAborted();
    if (this.stopped) throw new Error('Collaboration Feature is stopped.');
  }

  private async dispatch<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.dispatches.get(threadId) ?? Promise.resolve();
    const run = previous.then(operation);
    const settled = run.catch(() => undefined);
    this.dispatches.set(threadId, settled);
    try { return await run; }
    finally { if (this.dispatches.get(threadId) === settled) this.dispatches.delete(threadId); }
  }
}

function receiverId(input: Record<string, unknown>): string {
  return requiredString(input, ['thread_id', 'threadId', 'receiver_thread_id', 'receiverThreadId'], 'thread_id');
}

function mailboxContent(input: Record<string, unknown>): string {
  const content = requiredString(input, ['content', 'prompt', 'input'], 'content');
  if (content.length > 8_000) throw new Error('Collaboration messages are limited to 8000 characters. Use a result reference for larger output.');
  return content;
}

function toolResult(tool: RuntimeCollabToolName, senderThreadId: string, receiverThreadId: string, payload: Record<string, unknown>): CollaborationToolExecutionResult {
  const data = { tool, senderThreadId, receiverThreadId, ...payload };
  return {
    collabToolCall: { tool, senderThreadId, receiverThreadId, agentStatus: String(payload.status) },
    content: JSON.stringify(data), data, preview: `${tool}: ${receiverThreadId} ${payload.status}.`,
  };
}
