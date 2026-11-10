import { createHash } from 'node:crypto';
import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import type {
  Assistant, AssistantRequestAnswer, AssistantsRuntimeHost, AssistantsState, AssistantTask, AssistantTaskOrigin,
  AssistantTaskStatus, AssistantTurnOutcome,
} from '../contracts/index.js';
import { isActiveTask } from '../contracts/index.js';
import type { AssistantAccess } from './access.js';
import type { AssistantDeliveryOutbox } from './deliveries.js';
import type { AssistantsStateStore, AssistantsTransaction } from './state-store.js';
import {
  clip, formatTaskReport, markReported, matchTaskEvent, reportReason, requestFromApproval, taskStatusFromOutcome,
} from './task-reports.js';

const REPORT_DELAY_MS = 1_500;
const REPORT_RETRY_MS = 30_000;
const TASK_EVENT_TYPES: ReadonlySet<string> = new Set([
  'message.created', 'approval.requested', 'approval.resolved', 'turn.completed', 'turn.cancelled', 'runtime.error', 'thread.deleted',
]);

export type AssistantDispatchInput = {
  projectId: string;
  title: string;
  instructions: string;
  /** Continue this project conversation instead of creating a new one. */
  threadId?: string;
  /** Run in a fresh worktree instead of queueing behind other work in the same checkout. */
  parallel?: boolean;
};

export class AssistantTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantTaskError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Tracks project tasks independently of the assistant turn that created them. Tasks live in ordinary
 * project conversations; this coordinator only keeps the link, follows their events and reports back.
 */
export class AssistantTaskCoordinator {
  private readonly reportTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private watched = new Set<string>();
  private disposed = false;

  constructor(
    private readonly host: AssistantsRuntimeHost,
    private readonly store: AssistantsStateStore,
    private readonly access: AssistantAccess,
    private readonly outbox: AssistantDeliveryOutbox,
    private readonly onError: (error: unknown) => void,
  ) {
    store.onCommit((state) => {
      this.watched = new Set(state.tasks.filter(isActiveTask).map((task) => task.workThreadId));
    });
  }

  tasks(assistantId: string): AssistantTask[] {
    return structuredClone(this.store.current.tasks.filter((task) => task.assistantId === assistantId));
  }

  async dispatch(assistant: Assistant, origin: AssistantTaskOrigin, input: AssistantDispatchInput): Promise<AssistantTask> {
    const project = await this.access.project(assistant, input.projectId);
    const existing = input.threadId ? await this.access.thread(assistant, input.threadId, project.id) : null;
    if (input.parallel && !existing && !project.git) throw new AssistantTaskError('Parallel work needs a Git project so it can run in a worktree.');
    return this.store.mutate(async (transaction) => {
      const { state } = transaction;
      const owner = currentAssistant(state, assistant.id);
      await this.access.project(owner, project.id);
      if (input.parallel && existing) throw new AssistantTaskError('Choose either an existing conversation or a new parallel worktree.');
      const id = this.host.id('assistant_task');
      // Capture new work once; continuing a conversation retains its original task configuration.
      const execution = existing
        ? state.tasks.find((task) => task.assistantId === owner.id && task.workThreadId === existing.id && task.execution)?.execution
        : owner.modelSelection ? { modelSelection: { ...owner.modelSelection }, ...(owner.thinkingEffort ? { thinkingEffort: owner.thinkingEffort } : {}) } : undefined;
      const thread = existing ?? await this.host.createWorkThread({ title: input.title, projectId: project.id, worktree: Boolean(input.parallel), taskId: id,
        ...(execution?.modelSelection ? { modelSelection: execution.modelSelection } : {}),
      });
      const now = this.now();
      const task: AssistantTask = {
        id, assistantId: assistant.id, title: input.title, origin, projectId: project.id, workThreadId: thread.id,
        workspaceKey: thread.workspaceKey, instructions: input.instructions, status: 'pending', requests: [], createdAt: now, updatedAt: now,
        ...(execution ? { execution: structuredClone(execution) } : {}),
      };
      state.tasks.push(task);
      // Persist the relationship before the project conversation can start changing files.
      await transaction.commit();
      if (!workspaceBusy(state, task)) await this.submit(task, transaction);
      // The tool result tells the assistant the starting state, so it is already reported.
      markReported(task);
      return structuredClone(task);
    });
  }

  followup(assistant: Assistant, taskId: string, message: string): Promise<AssistantTask> {
    return this.store.mutate(async (transaction) => {
      const { state } = transaction;
      const task = requireTask(state, assistant.id, taskId);
      await this.access.thread(currentAssistant(state, assistant.id), task.workThreadId, task.projectId);
      if ((task.status === 'pending' || task.status === 'queued') && task.instructions.length + message.length + 2 > 32_000) {
        throw new AssistantTaskError('The combined instructions are too long. Wait for the task to start before adding more.');
      }
      if (task.status === 'pending') {
        task.instructions = `${task.instructions}\n\n${message}`;
      } else if (task.status === 'queued') {
        // Merge into the queued input so the project conversation receives one coherent request.
        if (!task.queuedInputId || !await this.host.deleteQueuedInput(task.workThreadId, task.queuedInputId)) {
          throw new AssistantTaskError('The task has just started. Check its status and send the follow-up again.');
        }
        task.instructions = `${task.instructions}\n\n${message}`;
        await this.submit(task, transaction);
      } else if ((task.status === 'running' || task.status === 'waiting') && task.turnId) {
        await this.host.steerTurn(task.workThreadId, task.turnId, message);
      } else {
        // A finished task continues in the same project conversation with a new turn.
        Object.assign(task, { instructions: message, status: 'pending', requests: [] });
        for (const key of ['turnId', 'queuedInputId', 'result', 'error', 'finishedAt'] as const) delete task[key];
        if (!workspaceBusy(state, task)) await this.submit(task, transaction);
        markReported(task);
      }
      task.updatedAt = this.now();
      return structuredClone(task);
    });
  }

  cancel(assistant: Assistant, taskId: string): Promise<AssistantTask> {
    return this.store.mutate(async (transaction) => {
      const { state } = transaction;
      const task = requireTask(state, assistant.id, taskId);
      await this.access.thread(currentAssistant(state, assistant.id), task.workThreadId, task.projectId);
      if (!isActiveTask(task)) return structuredClone(task);
      const removed = task.status === 'pending'
        || (task.status === 'queued' && task.queuedInputId !== undefined && await this.host.deleteQueuedInput(task.workThreadId, task.queuedInputId));
      if (removed) {
        this.finish(task, 'cancelled', {});
        await this.startNextPending(transaction, task.workspaceKey);
      } else if (task.turnId) {
        // turn.cancelled finalizes the task; the assistant already knows, so do not wake it again.
        await this.host.cancelTurn(task.workThreadId, task.turnId);
        task.reported = { status: 'cancelled', requestIds: task.requests.map((request) => request.id) };
      } else {
        throw new AssistantTaskError('The task is starting. Try cancelling again in a moment.');
      }
      task.updatedAt = this.now();
      return structuredClone(task);
    });
  }

  async answer(assistant: Assistant, taskId: string, requestId: string, answer: AssistantRequestAnswer): Promise<void> {
    await this.store.settled();
    const task = requireTask(this.store.current, assistant.id, taskId);
    await this.access.thread(currentAssistant(this.store.current, assistant.id), task.workThreadId, task.projectId);
    const request = task.requests.find((item) => item.id === requestId);
    if (!request) throw new AssistantTaskError('The request is no longer pending.');
    if (request.kind === 'desktop') throw new AssistantTaskError('This request can only be answered in Setsuna Desktop.');
    if (request.kind === 'approval' && !answer.decision) throw new AssistantTaskError('An approval needs decision approve, approve_for_session or reject.');
    if (request.kind === 'input' && !answer.action) throw new AssistantTaskError('An input request needs action submit or decline.');
    await this.host.answerApproval(requestId, answer);
  }

  handleEvent(event: StoredThreadEvent): void {
    if (this.disposed || !TASK_EVENT_TYPES.has(event.type) || !this.watched.has(event.threadId)) return;
    void this.store.mutate(async (transaction) => {
      const { state } = transaction;
      for (const task of state.tasks.filter((item) => isActiveTask(item) && item.workThreadId === event.threadId)) {
        if (event.type === 'thread.deleted') {
          await this.settle(transaction, task, { status: 'missing', error: '项目对话已被删除。' });
          continue;
        }
        const match = matchTaskEvent(task, event);
        if (!match) continue;
        task.updatedAt = this.now();
        if (match.kind === 'input-started') {
          task.turnId = match.turnId;
          delete task.queuedInputId;
          if (task.status === 'queued') task.status = 'running';
        } else if (match.kind === 'request') {
          if (!task.requests.some((request) => request.id === match.request.id)) task.requests.push(match.request);
          task.status = 'waiting';
        } else if (match.kind === 'request-resolved') {
          task.requests = task.requests.filter((request) => request.id !== match.requestId);
          if (!task.requests.length && task.status === 'waiting') task.status = 'running';
        } else {
          await this.settle(transaction, task, await this.host.turnOutcome(task.workThreadId, task.turnId!));
        }
      }
      this.scheduleReports(state);
    }).catch(this.onError);
  }

  /**
   * Restores task state from durable thread records after a restart: finished turns are settled,
   * running ones re-read their pending approvals, and owed reports are flushed again.
   */
  async recover(): Promise<void> {
    await this.store.mutate(async (transaction) => {
      const { state } = transaction;
      const approvals = (await this.host.listApprovals()).filter((approval) => approval.status === 'pending');
      for (const task of state.tasks.filter((item) => isActiveTask(item) && item.status !== 'pending')) {
        if (!task.turnId && task.clientId) {
          const location = await this.host.locateInput(task.workThreadId, { clientId: task.clientId, queuedInputId: task.queuedInputId });
          if (location.state === 'queued') continue;
          if (location.state === 'started') Object.assign(task, { turnId: location.turnId, status: 'running' });
        }
        const outcome: AssistantTurnOutcome = task.turnId ? await this.host.turnOutcome(task.workThreadId, task.turnId) : { status: 'missing' };
        if (outcome.status === 'running') {
          task.requests = approvals.filter((approval) => approval.threadId === task.workThreadId && approval.turnId === task.turnId).map(requestFromApproval);
          task.status = task.requests.length ? 'waiting' : 'running';
        } else {
          await this.settle(transaction, task, outcome);
        }
      }
      for (const key of new Set(state.tasks.filter((task) => task.status === 'pending').map((task) => task.workspaceKey))) {
        await this.startNextPending(transaction, key);
      }
      this.scheduleReports(state);
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.reportTimers.values()) clearTimeout(timer);
    this.reportTimers.clear();
  }

  private async submit(task: AssistantTask, transaction: AssistantsTransaction): Promise<void> {
    try {
      await this.access.thread(currentAssistant(transaction.state, task.assistantId), task.workThreadId, task.projectId);
    } catch (error) {
      this.finish(task, 'cancelled', { error: errorMessage(error) });
      return;
    }
    task.clientId = this.host.id('assistant_input');
    task.status = 'queued';
    delete task.turnId;
    delete task.queuedInputId;
    // Crash recovery locates this durable submission intent; it never starts that work again.
    await transaction.commit();
    try {
      const started = await this.host.startTurn(task.workThreadId, { input: task.instructions, clientId: task.clientId, ...task.execution });
      task.status = started.turnId ? 'running' : 'queued';
      if (started.turnId) task.turnId = started.turnId;
      if (started.queuedInputId) task.queuedInputId = started.queuedInputId;
    } catch (error) {
      this.finish(task, 'failed', { error: errorMessage(error) });
    }
    task.updatedAt = this.now();
  }

  private async settle(transaction: AssistantsTransaction, task: AssistantTask, outcome: AssistantTurnOutcome): Promise<void> {
    const status = taskStatusFromOutcome(outcome);
    if (!status) return;
    this.finish(task, status, {
      ...(outcome.finalAnswer ? { result: outcome.finalAnswer } : {}),
      ...(outcome.error ? { error: outcome.error } : status === 'interrupted' ? { error: '任务因应用退出或对话被删除而中断。' } : {}),
    });
    await this.startNextPending(transaction, task.workspaceKey);
  }

  private finish(task: AssistantTask, status: AssistantTaskStatus, outcome: { result?: string; error?: string }): void {
    const now = this.now();
    Object.assign(task, { status, requests: [], finishedAt: now, updatedAt: now });
    delete task.queuedInputId;
    if (outcome.result) task.result = clip(outcome.result, 8_000);
    if (outcome.error) task.error = clip(outcome.error, 4_000);
  }

  /** Starts the oldest task waiting for this workspace once no other write task occupies it. */
  private async startNextPending(transaction: AssistantsTransaction, workspaceKey: string): Promise<void> {
    const { state } = transaction;
    for (const task of state.tasks.filter((item) => item.status === 'pending' && item.workspaceKey === workspaceKey)) {
      if (workspaceBusy(state, task)) return;
      await this.submit(task, transaction);
      // Revocation or submission failure must not strand later work waiting for another event.
      if (isActiveTask(task)) return;
    }
  }

  private scheduleReports(state: AssistantsState, delay = REPORT_DELAY_MS): void {
    for (const threadId of new Set(state.tasks.filter((task) => reportReason(task)).map((task) => task.origin.threadId))) {
      this.scheduleReport(threadId, delay);
    }
  }

  /** Coalesces bursts of task changes into one wake-up per assistant conversation. */
  private scheduleReport(threadId: string, delay: number): void {
    if (this.disposed || this.reportTimers.has(threadId)) return;
    const timer = setTimeout(() => {
      this.reportTimers.delete(threadId);
      void this.flushReports(threadId).catch((error) => {
        this.onError(error);
        this.scheduleReport(threadId, REPORT_RETRY_MS);
      });
    }, delay);
    timer.unref?.();
    this.reportTimers.set(threadId, timer);
  }

  private flushReports(threadId: string): Promise<void> {
    return this.store.mutate(async ({ state }) => {
      const owed = state.tasks.filter((task) => task.origin.threadId === threadId && reportReason(task));
      const authorized: AssistantTask[] = [];
      for (const task of owed) {
        const assistant = state.assistants.find((item) => item.id === task.assistantId);
        const peerAllowed = !task.origin.peer || state.peers.some((peer) => peer.assistantId === task.assistantId
          && peer.status === 'allowed' && peer.kind === task.origin.peer!.kind && peer.openid === task.origin.peer!.openid);
        if (!assistant || !peerAllowed || !(await this.access.projects(assistant)).some((project) => project.id === task.projectId)) {
          markReported(task);
        } else authorized.push(task);
      }
      // A shared conversation still routes each report to the source that requested that work.
      const routeKey = (task: AssistantTask) => JSON.stringify([task.origin.peer ?? null, task.origin.initiator ?? null]);
      const tasks = authorized.filter((task) => routeKey(task) === routeKey(authorized[0]!));
      if (!tasks.length) return;
      // A deleted assistant conversation has nobody to report to; drop the debt instead of retrying forever.
      if (!state.conversations.some((conversation) => conversation.threadId === threadId) || !await this.host.getThreadInfo(threadId)) {
        tasks.forEach(markReported);
        return;
      }
      const projects = new Map((await this.host.listProjects()).map((project) => [project.id, project.name]));
      // Stable across retries, including a crash between Core's receipt and our own commit.
      const receipt = createHash('sha256').update(JSON.stringify(tasks.map((task) => [task.id, task.clientId, task.status, task.requests.map((request) => request.id)]))).digest('hex');
      const { turnId } = await this.host.deliverMailbox(threadId, {
        id: `assistant_report_${receipt}`,
        content: formatTaskReport(tasks, (projectId) => projects.get(projectId) ?? projectId),
        fromThreadId: tasks[0]!.workThreadId,
        thinkingEffort: currentAssistant(state, tasks[0]!.assistantId).thinkingEffort ?? '',
      });
      if (!turnId) { this.scheduleReport(threadId, REPORT_RETRY_MS); return; }
      for (const task of tasks) {
        markReported(task);
        // Work requested from QQ reports back to the chat it came from, not to other conversations.
        if (turnId && task.origin.peer) {
          this.outbox.expectReply(state, {
            assistantId: task.assistantId, peer: task.origin.peer, threadId, turnId,
            projectIds: tasks.map((item) => item.projectId),
            ...(task.origin.messageId ? { replyToMessageId: task.origin.messageId } : {}),
            ...(task.origin.initiator ? { initiator: task.origin.initiator } : {}),
          });
        }
      }
      this.scheduleReports(state);
    }).then(() => this.outbox.recover());
  }

  private now(): string { return this.host.now().toISOString(); }
}

function currentAssistant(state: Readonly<AssistantsState>, assistantId: string): Assistant {
  const assistant = state.assistants.find((item) => item.id === assistantId);
  if (!assistant) throw new AssistantTaskError('Assistant is no longer available.');
  return assistant;
}

function requireTask(state: Readonly<AssistantsState>, assistantId: string, taskId: string): AssistantTask {
  const task = state.tasks.find((item) => item.id === taskId && item.assistantId === assistantId);
  if (!task) throw new AssistantTaskError(`Task ${taskId} does not exist for this assistant.`);
  return task;
}

/**
 * Write tasks in one checkout run serially. A task waits while an older task is pending for the same
 * workspace, or while another conversation is working there; the same conversation uses its own queue.
 */
function workspaceBusy(state: AssistantsState, task: AssistantTask): boolean {
  return state.tasks.some((other) => other.id !== task.id && other.workspaceKey === task.workspaceKey && (
    (other.status === 'pending' && state.tasks.indexOf(other) < state.tasks.indexOf(task))
    || (isActiveTask(other) && other.status !== 'pending' && other.workThreadId !== task.workThreadId)
  ));
}
