import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  automationDraftCodec, type AutomationDraft, type AutomationRun, type AutomationRuntimeHost,
  type AutomationSnapshot, type AutomationState, type AutomationTask,
} from '../contracts/index.js';
import { nextAutomationRun } from './schedule.js';
import { AutomationStore } from './store.js';

export const AUTOMATION_CREATION_POLICY = [
  'You help the user create and edit local scheduled tasks through a friendly conversation.',
  'A scheduled task executes its saved prompt as an unattended agent conversation on this computer.',
  'Use manage_automation to save the task. Do not implement schedules using shell commands, OS cron, or a background sleep.',
  'Ask for missing task content and timing using request_user_input with a short, friendly form and sensible prefilled values.',
  'Relevant fields are title, prompt, repeat rule, time/date, optional model and thinking effort, and whether each run opens a new chat.',
  'Infer fields already stated by the user; do not ask them to repeat those fields. The default is to reuse the execution chat.',
  'The task runs locally with full access and without user input forms. Keep its prompt self-contained.',
  'After saving, briefly confirm the next run time. Never claim a schedule exists before the tool succeeds.',
].join(' ');

export class AutomationService {
  private state: AutomationState = { tasks: [] };
  private pending: Promise<unknown> = Promise.resolve();
  private pendingMutations = 0;
  private maintenancePaused = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private readonly store: AutomationStore;

  constructor(private readonly host: AutomationRuntimeHost, private readonly onError: (error: unknown) => void = () => undefined) {
    this.store = new AutomationStore(host.dataDir);
  }

  async initialize(): Promise<void> {
    const state = await this.store.read();
    await this.host.reconcileConversationOwnership(state, AUTOMATION_CREATION_POLICY);
    const now = this.host.now().toISOString();
    for (const task of state.tasks) {
      for (const run of task.runs) {
        if (run.status !== 'running') continue;
        // A turn can finish before the next scheduler tick persists its result.
        // Recover that result from the transcript, but never replay a reservation.
        const result = run.turnId ? await this.host.runStatus(run).catch(() => null) : null;
        Object.assign(run, result && result.status !== 'running'
          ? { ...result, finishedAt: now }
          : { status: 'interrupted', finishedAt: now, error: '运行因应用退出而中断。' });
      }
    }
    await this.commit(state);
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { void this.tick().catch(this.onError); }, 5_000);
    this.timer.unref?.();
    void this.tick().catch(this.onError);
  }

  pendingMutationCount(): number { return this.pendingMutations; }

  /** Called synchronously with Core admission changes; readiness must first drain this queue. */
  setMaintenancePaused(paused: boolean): void {
    const resumed = this.maintenancePaused && !paused;
    this.maintenancePaused = paused;
    if (resumed && this.timer && !this.stopped) void this.tick().catch(this.onError);
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.pending;
  }

  async snapshot(): Promise<AutomationSnapshot> {
    await this.pending;
    const [models, projects] = await Promise.all([this.host.listModels(), this.host.listProjects()]);
    return { ...structuredClone(this.state), models, projects };
  }

  createConversation(): Promise<{ threadId: string }> {
    return this.mutate(async () => {
      const draftId = this.state.draftThreadId;
      if (draftId && !this.state.tasks.some((task) => task.conversationThreadId === draftId)
        && await this.host.canReuseConversation(draftId)) return { threadId: draftId };
      const threadId = await this.host.createConversation(AUTOMATION_CREATION_POLICY);
      await this.commit({ ...this.state, draftThreadId: threadId });
      return { threadId };
    });
  }

  create(threadId: string, input: AutomationDraft): Promise<AutomationTask> {
    return this.mutate(async () => {
      if (!await this.host.threadExists(threadId)) throw failure('INVALID_INPUT', '对话不存在。');
      const draft = await this.validateDraft(input, threadId);
      const now = this.host.now();
      const nextRunAt = nextAutomationRun(draft.schedule, now);
      if (!nextRunAt) throw failure('INVALID_INPUT', '请选择未来的执行时间。');
      const task: AutomationTask = {
        ...draft, id: this.host.id('automation'), conversationThreadId: threadId,
        createdAt: now.toISOString(), updatedAt: now.toISOString(), status: 'active', nextRunAt, runs: [],
      };
      await this.commit({ ...this.state, tasks: [...this.state.tasks, task],
        draftThreadId: this.state.draftThreadId === threadId ? undefined : this.state.draftThreadId });
      return structuredClone(task);
    });
  }

  update(taskId: string, input: AutomationDraft): Promise<AutomationTask> {
    return this.mutate(async () => {
      const task = structuredClone(this.require(taskId));
      const draft = await this.validateDraft({ ...input, projectId: input.projectId === undefined ? task.projectId : input.projectId }, task.conversationThreadId);
      const scheduleChanged = JSON.stringify(draft.schedule) !== JSON.stringify(task.schedule);
      if (draft.projectId !== task.projectId) {
        if (task.runs.some((run) => run.status === 'running')) throw failure('TASK_BUSY', '请先停止正在运行的对话，再更改项目。');
        // A reused transcript keeps its original workspace; a new destination needs a fresh chat.
        delete task.executionThreadId;
      }
      Object.assign(task, draft, { updatedAt: this.host.now().toISOString() });
      // A cleared effort must not survive a model change through Object.assign's omitted fields.
      if (draft.thinkingEffort === undefined) delete task.thinkingEffort;
      if (scheduleChanged) {
        const nextRunAt = nextAutomationRun(draft.schedule, this.host.now());
        if (!nextRunAt) throw failure('INVALID_INPUT', '请选择未来的执行时间。');
        task.nextRunAt = task.status === 'paused' ? null : nextRunAt;
        if (task.status === 'completed') task.status = 'active';
      }
      await this.replace(task);
      return structuredClone(task);
    });
  }

  setStatus(taskId: string, status: 'active' | 'paused'): Promise<AutomationTask> {
    return this.mutate(async () => {
      const task = structuredClone(this.require(taskId));
      if (task.status === status) return task;
      task.status = status;
      task.updatedAt = this.host.now().toISOString();
      task.nextRunAt = status === 'active' ? nextAutomationRun(task.schedule, this.host.now()) : null;
      if (status === 'active' && !task.nextRunAt) throw failure('INVALID_INPUT', '执行时间已过，请先编辑任务。');
      await this.replace(task);
      return structuredClone(task);
    });
  }

  delete(taskId: string): Promise<{ deleted: boolean }> {
    return this.mutate(async () => {
      const task = this.state.tasks.find((item) => item.id === taskId);
      if (!task) return { deleted: false };
      if (task.runs.some((run) => run.status === 'running')) throw failure('TASK_BUSY', '请先停止正在运行的对话。');
      await this.commit({ ...this.state, tasks: this.state.tasks.filter((item) => item.id !== taskId) });
      return { deleted: true };
    });
  }

  run(taskId: string): Promise<AutomationTask> {
    return this.mutate(() => this.dispatch(this.require(taskId), this.host.now().toISOString(), false));
  }

  tick(): Promise<void> {
    if (this.maintenancePaused) return Promise.resolve();
    return this.mutate(async () => {
      for (const item of [...this.state.tasks]) {
        let task = structuredClone(this.require(item.id));
        let changed = false;
        for (const run of task.runs) {
          if (run.status !== 'running') continue;
          const result = await this.host.runStatus(run);
          if (result.status !== 'running') {
            Object.assign(run, result, { finishedAt: this.host.now().toISOString() });
            changed = true;
          }
        }
        if (changed) await this.replace(task);
        if (task.status !== 'active' || !task.nextRunAt || Date.parse(task.nextRunAt) > this.host.now().getTime()) continue;
        if (task.runs.some((run) => run.status === 'running')) {
          task.nextRunAt = nextAutomationRun(task.schedule, this.host.now(), task.nextRunAt);
          if (!task.nextRunAt) task.status = 'completed';
          await this.replace(task);
          continue;
        }
        task = await this.dispatch(task, task.nextRunAt, true);
      }
    });
  }

  private async dispatch(original: AutomationTask, scheduledFor: string, scheduled: boolean): Promise<AutomationTask> {
    const task = structuredClone(original);
    if (task.runs.some((run) => run.status === 'running')) throw failure('TASK_BUSY', '任务正在运行。');
    const run: AutomationRun = {
      id: this.host.id('automation_run'), threadId: task.executionThreadId ?? task.conversationThreadId,
      scheduledFor, startedAt: this.host.now().toISOString(), status: 'running',
    };
    task.runs = [...task.runs.slice(-49), run];
    task.updatedAt = run.startedAt;
    if (scheduled) {
      task.nextRunAt = nextAutomationRun(task.schedule, this.host.now(), scheduledFor);
      if (!task.nextRunAt) task.status = 'completed';
    }
    // Reserve durably before starting: a crash must not replay a destructive
    // unattended task. On restart the reserved run is reported as interrupted.
    await this.replace(task);
    try {
      await this.host.resolveProject(task.conversationThreadId, task.projectId);
      const threadId = !task.newChat && task.executionThreadId && await this.host.threadExists(task.executionThreadId)
        ? task.executionThreadId : await this.host.createExecutionThread(task);
      run.threadId = threadId;
      if (!task.newChat) task.executionThreadId = threadId;
      // Persist the transcript's owner before an agent can start modifying files.
      await this.replace(task);
      run.turnId = await this.host.startRun(threadId, {
        input: task.prompt, modelSelection: task.modelSelection,
        thinking: Boolean(task.thinkingEffort), thinkingEffort: task.thinkingEffort,
      });
    } catch (error) {
      run.status = 'failed';
      run.error = (error instanceof Error ? error.message : String(error)).slice(0, 4_000);
      run.finishedAt = this.host.now().toISOString();
    }
    await this.replace(task);
    return structuredClone(task);
  }

  private async validateDraft(input: AutomationDraft, threadId: string): Promise<AutomationDraft> {
    const draft = automationDraftCodec.parse(input);
    try { draft.projectId = await this.host.resolveProject(threadId, draft.projectId); }
    catch (error) { throw failure('INVALID_INPUT', error instanceof Error ? error.message : String(error)); }
    draft.modelSelection ??= await this.host.defaultModel(threadId);
    const models = await this.host.listModels();
    const model = models.find((item) => item.providerId === draft.modelSelection?.providerId && item.modelId === draft.modelSelection?.modelId);
    if (!model) throw failure('INVALID_INPUT', '请先配置可用模型。');
    if (draft.thinkingEffort && !model.thinkingEfforts.includes(draft.thinkingEffort)) throw failure('INVALID_INPUT', '模型不支持所选强度。');
    return draft;
  }

  private require(taskId: string): AutomationTask {
    const task = this.state.tasks.find((item) => item.id === taskId);
    if (!task) throw failure('TASK_NOT_FOUND', '定时任务不存在。');
    return task;
  }
  private replace(task: AutomationTask): Promise<void> {
    return this.commit({ ...this.state, tasks: this.state.tasks.map((item) => item.id === task.id ? task : item) });
  }
  private async commit(state: AutomationState): Promise<void> {
    await this.store.write(state);
    this.state = structuredClone(state);
  }
  private mutate<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopped) return Promise.reject(new Error('Automation service is stopped.'));
    if (this.maintenancePaused) return Promise.reject(failure('RUNTIME_MAINTENANCE', 'Runtime maintenance is in progress.'));
    // Count queued work at admission, not when it starts, so prepare cannot overtake a durable write.
    this.pendingMutations += 1;
    const result = this.pending.then(work).finally(() => { this.pendingMutations -= 1; });
    this.pending = result.catch(() => undefined);
    return result;
  }
}

function failure(code: string, message: string): FeatureOperationFailure {
  return new FeatureOperationFailure({ code, message, retryable: false });
}
