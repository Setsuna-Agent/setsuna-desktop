import type { RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import { latestFileChangeSummaryFromMessages, type RuntimeFileChangeSummary } from './runtimeFileChanges.js';

export type ConversationPlanStatus = 'pending' | 'in_progress' | 'completed';

export type ConversationPlanItem = {
  step: string;
  status: ConversationPlanStatus;
};

export type ConversationOverviewState = {
  fileChangeSummary: RuntimeFileChangeSummary | null;
  planItems: ConversationPlanItem[];
};

export function conversationOverviewFromMessages(messages: RuntimeMessage[]): ConversationOverviewState {
  const fileChangeSummary = latestFileChangeSummaryFromMessages(messages);
  return {
    fileChangeSummary: fileChangeSummary?.files.length ? fileChangeSummary : null,
    planItems: latestPlanItemsFromMessages(messages),
  };
}

export function latestPlanItemsFromMessages(messages: RuntimeMessage[]): ConversationPlanItem[] {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const runs = messages[messageIndex]?.toolRuns ?? [];
    for (let runIndex = runs.length - 1; runIndex >= 0; runIndex -= 1) {
      const run = runs[runIndex];
      if (run?.name !== 'update_plan') continue;
      const plan = planItemsFromToolRun(run);
      if (plan.length) return plan;
    }
  }
  return [];
}

function planItemsFromToolRun(run: RuntimeToolRun): ConversationPlanItem[] {
  const dataPlan = isRecord(run.data) ? normalizePlanItems(run.data.plan) : [];
  if (dataPlan.length) return dataPlan;

  const args = parseJsonObject(run.argumentsPreview);
  const argumentPlan = normalizePlanItems(args?.plan);
  if (argumentPlan.length) return argumentPlan;

  const result = parseJsonObject(run.resultPreview);
  return normalizePlanItems(result?.plan);
}

function normalizePlanItems(value: unknown): ConversationPlanItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const step = typeof item.step === 'string' ? item.step.trim() : '';
      const status = normalizePlanStatus(item.status);
      return step && status ? { step, status } : null;
    })
    .filter((item): item is ConversationPlanItem => Boolean(item));
}

function normalizePlanStatus(value: unknown): ConversationPlanStatus | null {
  if (value === 'completed' || value === 'in_progress' || value === 'pending') return value;
  return null;
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
