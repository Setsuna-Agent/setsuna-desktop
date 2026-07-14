import type { RuntimeConfigState, RuntimeHookRun, RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { RuntimeToolExecutionContext, ToolExecutionContext, ToolExecutionEnvironment, ToolHost } from '../ports/tool-host.js';
import {
  createRuntimeToolHookRunner,
  type RuntimeCompactHookTrigger,
  type RuntimeSessionStartSource,
  type RuntimeStopHookOutcome,
} from '../hooks/runtime-hooks.js';
import type { RuntimeToolCallExecutor } from './runtime-tool-call-executor.js';
import { neutralizePromptClosingTags } from './prompt-utils.js';

export type RuntimeTurnStartHookResult =
  | { stopped: true; reason: string }
  | { stopped: false; contextMessages: RuntimeMessage[] };

type RuntimeHookCoordinatorOptions = {
  clock: Clock;
  ids: IdGenerator;
  toolExecutor: Pick<RuntimeToolCallExecutor, 'publishHookStarted' | 'publishHookCompleted'>;
  toolHost?: ToolHost;
};

/**
 * Coordinates hook lifecycle and session-start state outside the turn loop.
 * Hook execution stays policy-driven while AgentLoop only reacts to outcomes.
 */
export class RuntimeHookCoordinator {
  private readonly initializedThreadIds = new Set<string>();
  private readonly pendingSessionStartSources = new Map<string, RuntimeSessionStartSource[]>();

  constructor(private readonly options: RuntimeHookCoordinatorOptions) {}

  queueSessionStartSource(threadId: string, source: RuntimeSessionStartSource): void {
    const pending = this.pendingSessionStartSources.get(threadId) ?? [];
    pending.push(source);
    this.pendingSessionStartSources.set(threadId, pending);
  }

  async runTurnStartHooks({
    prompt,
    runtimeConfig,
    signal,
    thread,
    turnId,
  }: {
    prompt: string;
    runtimeConfig: RuntimeConfigState | null | undefined;
    signal: AbortSignal;
    thread: RuntimeThread;
    turnId: string;
  }): Promise<RuntimeTurnStartHookResult> {
    const runner = createRuntimeToolHookRunner(runtimeConfig);
    const context: ToolExecutionContext & { turnId: string } = {
      threadId: thread.id,
      projectId: thread.projectId,
      turnId,
      permissionProfile: runtimeConfig?.permissionProfile ?? 'workspace-write',
      sandboxWorkspaceWrite: runtimeConfig?.sandboxWorkspaceWrite ?? {},
      features: runtimeConfig?.features ?? {},
      signal,
    };
    const environment = await this.environmentForContext(context);
    const events = this.hookEvents(thread.id, turnId);
    const sessionStartSource = this.takeSessionStartSource(thread);
    const sessionStartOutcome = sessionStartSource
      ? await runner?.runSessionStart({
          approvalPolicy: runtimeConfig?.approvalPolicy ?? 'on-request',
          context,
          environment,
          events,
          source: sessionStartSource,
        })
      : undefined;
    if (sessionStartOutcome?.shouldStop) {
      return { stopped: true, reason: sessionStartOutcome.stopReason || 'SessionStart hook stopped this turn.' };
    }

    const userPromptOutcome = await runner?.runUserPromptSubmit({
      approvalPolicy: runtimeConfig?.approvalPolicy ?? 'on-request',
      context,
      environment,
      events,
      prompt,
    });
    if (userPromptOutcome?.shouldStop) {
      return { stopped: true, reason: userPromptOutcome.stopReason || 'UserPromptSubmit hook stopped this turn.' };
    }
    return {
      stopped: false,
      contextMessages: this.additionalContextMessages([
        ...(sessionStartOutcome?.additionalContexts ?? []),
        ...(userPromptOutcome?.additionalContexts ?? []),
      ], turnId),
    };
  }

  planModeContextMessages(turnId: string): RuntimeMessage[] {
    return [{
      id: 'desktop_plan_mode',
      turnId,
      role: 'developer',
      promptSource: 'plan',
      content: [
        '<plan_mode>',
        'Plan mode is active. Produce a concise implementation plan or review plan only.',
        'Do not call tools, edit files, run commands, or claim completed work in this turn.',
        'End by waiting for the user to confirm before execution.',
        '</plan_mode>',
      ].join('\n'),
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'model',
    }];
  }

  stopContinuationMessages(reason: string, turnId: string): RuntimeMessage[] {
    const text = reason.trim();
    if (!text) return [];
    return [{
      id: this.options.ids.id('msg'),
      turnId,
      role: 'developer',
      promptSource: 'hook',
      content: [
        '<hook_stop_continuation>',
        neutralizePromptClosingTags(text, ['hook_stop_continuation']),
        '</hook_stop_continuation>',
      ].join('\n'),
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'model',
    }];
  }

  async runCompactHooks({
    eventName,
    runtimeConfig,
    signal,
    thread,
    trigger,
    turnId,
  }: {
    eventName: 'PreCompact' | 'PostCompact';
    runtimeConfig: RuntimeConfigState | null | undefined;
    signal?: AbortSignal;
    thread: RuntimeThread;
    trigger: RuntimeCompactHookTrigger;
    turnId: string;
  }) {
    const runner = createRuntimeToolHookRunner(runtimeConfig);
    if (!runner) return { shouldStop: false };
    const context: ToolExecutionContext & { turnId: string } = {
      threadId: thread.id,
      projectId: thread.projectId,
      turnId,
      permissionProfile: runtimeConfig?.permissionProfile ?? 'workspace-write',
      sandboxWorkspaceWrite: runtimeConfig?.sandboxWorkspaceWrite ?? {},
      features: runtimeConfig?.features ?? {},
      signal,
    };
    const input = {
      approvalPolicy: runtimeConfig?.approvalPolicy ?? 'on-request',
      context,
      environment: await this.environmentForContext(context),
      events: this.hookEvents(thread.id, turnId),
      trigger,
    };
    return eventName === 'PreCompact' ? runner.runPreCompact(input) : runner.runPostCompact(input);
  }

  async runStopHooks({
    context,
    lastAssistantMessage,
    runtimeConfig,
    stopHookActive,
  }: {
    context: RuntimeToolExecutionContext;
    lastAssistantMessage: string;
    runtimeConfig: RuntimeConfigState | null | undefined;
    stopHookActive: boolean;
  }): Promise<RuntimeStopHookOutcome> {
    const runner = createRuntimeToolHookRunner(runtimeConfig);
    if (!runner) return { shouldBlock: false, shouldStop: false };
    return runner.runStop({
      approvalPolicy: runtimeConfig?.approvalPolicy ?? 'on-request',
      context,
      environment: await this.environmentForContext(context),
      events: this.hookEvents(context.threadId, context.turnId),
      lastAssistantMessage,
      stopHookActive,
    });
  }

  private takeSessionStartSource(thread: RuntimeThread): RuntimeSessionStartSource | null {
    const pending = this.pendingSessionStartSources.get(thread.id);
    const next = pending?.shift();
    if (pending && !pending.length) this.pendingSessionStartSources.delete(thread.id);
    if (next) {
      this.initializedThreadIds.add(thread.id);
      return next;
    }
    if (this.initializedThreadIds.has(thread.id)) return null;
    this.initializedThreadIds.add(thread.id);
    if (thread.forkedFromId) return 'startup';
    return thread.messages.length ? 'resume' : 'startup';
  }

  private async environmentForContext(context: ToolExecutionContext & { turnId: string }): Promise<ToolExecutionEnvironment> {
    const environment = this.options.toolHost?.environmentForToolContext
      ? await Promise.resolve(this.options.toolHost.environmentForToolContext(context)).catch(() => null)
      : null;
    return environment ?? {
      id: context.projectId ?? context.threadId,
      cwd: process.cwd(),
    };
  }

  private additionalContextMessages(contexts: string[], turnId: string): RuntimeMessage[] {
    const text = contexts.map((context) => context.trim()).filter(Boolean).join('\n\n');
    if (!text) return [];
    return [{
      id: this.options.ids.id('msg'),
      turnId,
      role: 'developer',
      promptSource: 'hook',
      content: [
        '<hook_additional_context>',
        neutralizePromptClosingTags(text, ['hook_additional_context']),
        '</hook_additional_context>',
      ].join('\n'),
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'model',
    }];
  }

  private hookEvents(threadId: string, turnId: string) {
    return {
      publishHookStarted: (run: RuntimeHookRun) => this.options.toolExecutor.publishHookStarted(threadId, turnId, run),
      publishHookCompleted: (run: RuntimeHookRun) => this.options.toolExecutor.publishHookCompleted(threadId, turnId, run),
    };
  }
}
