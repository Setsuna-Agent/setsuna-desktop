import type { AutomationDraft, AutomationSchedule, AutomationTask } from '../contracts/index.js';
import { automationDraftCodec } from '../contracts/index.js';

export type AutomationForm = {
  title: string; prompt: string; kind: AutomationSchedule['kind']; time: string; at: string;
  minutes: number; weekdays: number[]; newChat: boolean; modelKey: string; thinkingEffort: string;
  projectId?: string | null;
};

export function automationForm(task?: AutomationTask): AutomationForm {
  const schedule = task?.schedule;
  const nextHour = new Date(Date.now() + 3_600_000);
  return {
    title: task?.title ?? '', prompt: task?.prompt ?? '', kind: schedule?.kind ?? 'daily',
    time: schedule && 'time' in schedule ? schedule.time : '09:00',
    at: localDateTime(schedule?.kind === 'once' ? new Date(schedule.at) : nextHour),
    minutes: schedule?.kind === 'interval' ? schedule.minutes : 60,
    weekdays: schedule && 'weekdays' in schedule ? schedule.weekdays : [new Date().getDay()],
    newChat: task?.newChat ?? false, modelKey: task?.modelSelection ? JSON.stringify(task.modelSelection) : '',
    thinkingEffort: task?.thinkingEffort ?? '',
    projectId: task?.projectId,
  };
}

export function draftFromForm(form: AutomationForm): AutomationDraft {
  const schedule = form.kind === 'once' ? { kind: 'once', at: new Date(form.at).toISOString() }
    : form.kind === 'interval' ? { kind: 'interval', minutes: form.minutes }
    : form.kind === 'daily' || form.kind === 'weekdays' ? { kind: form.kind, time: form.time }
    : { kind: form.kind, time: form.time, weekdays: form.weekdays };
  return automationDraftCodec.parse({
    title: form.title, prompt: form.prompt, schedule, newChat: form.newChat,
    projectId: form.projectId,
    ...(form.modelKey ? { modelSelection: JSON.parse(form.modelKey) } : {}),
    ...(form.thinkingEffort ? { thinkingEffort: form.thinkingEffort } : {}),
  });
}

function localDateTime(at: Date): string {
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
