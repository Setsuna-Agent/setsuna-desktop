import type { AutomationState, AutomationTask } from '@setsuna-desktop/feature-automation/contracts';
import type { RuntimeContainer } from '../../runtime/runtime-factory.js';

const LEGACY_SETUP_WELCOME = '想自动完成什么任务？告诉我任务内容和执行时间，我会帮你安排。';
// Frozen seed from the first setup policy; existing transcripts retain that text.
const LEGACY_SETUP_POLICY = [
  'You help the user create and edit local scheduled tasks through a friendly conversation.',
  'A scheduled task executes its saved prompt as an unattended agent conversation on this computer.',
  'Use manage_automation to save the task. Do not implement schedules using shell commands, OS cron, or a background sleep.',
  'Ask for missing task content and timing using request_user_input with a short, friendly form and sensible prefilled values.',
  'Relevant fields are title, prompt, repeat rule, time/date, timezone, optional model and thinking effort, and whether each run opens a new chat.',
  'Infer fields already stated by the user; do not ask them to repeat those fields. The default is to reuse the execution chat.',
  'The task runs locally with full access and without user input forms. Keep its prompt self-contained.',
  'After saving, briefly confirm the next run time. Never claim a schedule exists before the tool succeeds.',
].join(' ');

/** Upgrade navigation ownership using saved task links and private seeds, never user-editable titles. */
export async function reconcileAutomationConversations(runtime: RuntimeContainer, state: AutomationState, instructions: string): Promise<void> {
  const summaries = await runtime.threadStore.listThreads({ includeArchived: true, includeFeatures: true });
  const byId = new Map(summaries.map((thread) => [thread.id, thread]));
  const executions = new Map<string, AutomationTask>();
  for (const task of state.tasks) {
    if (task.projectId === undefined) task.projectId = byId.get(task.executionThreadId ?? '')?.projectId ?? byId.get(task.conversationThreadId)?.projectId ?? null;
    const ids = [task.executionThreadId, ...task.runs.map((run) => run.threadId)];
    for (const id of ids) if (id && id !== task.conversationThreadId) executions.set(id, task);
  }
  for (const summary of summaries) {
    if (summary.featureId && summary.featureId !== 'automation') continue;
    const task = executions.get(summary.id);
    if (task) {
      const origin = { featureId: 'automation', entityId: task.id };
      // Once provenance exists, historical runs keep their original project even if the task changes.
      const projectId = !summary.origin && !summary.projectId ? task.projectId ?? undefined : undefined;
      if (summary.featureId === 'automation' || summary.origin?.featureId !== origin.featureId
        || summary.origin.entityId !== origin.entityId || projectId) {
        await runtime.eventWriter.append(summary.id, {
          id: runtime.ids.id('event'), threadId: summary.id, type: 'thread.updated', createdAt: runtime.clock.now().toISOString(),
          payload: { featureId: null, origin, projectId },
        });
      }
      continue;
    }
    const [seed, welcome] = summary.memoryMode === 'disabled'
      ? (await runtime.threadStore.listMessages(summary.id, { before: 2, limit: 2 })).messages : [];
    const seeded = seed?.role === 'developer' && seed.visibility === 'model'
      && (seed.content === instructions || seed.content === LEGACY_SETUP_POLICY);
    if (!seeded) continue;
    if (!summary.featureId) await runtime.threadStore.updateThread(summary.id, { featureId: 'automation' });
    // Retire only the old generated opening; real turns and execution transcripts stay intact.
    if (seeded && welcome?.role === 'assistant' && welcome.status === 'complete'
      && welcome.content === LEGACY_SETUP_WELCOME && !welcome.turnId
      && !welcome.toolRuns?.length && !welcome.hookRuns?.length) {
      await runtime.threadStore.deleteMessages(summary.id, { messageIds: [welcome.id] });
    }
  }
}
