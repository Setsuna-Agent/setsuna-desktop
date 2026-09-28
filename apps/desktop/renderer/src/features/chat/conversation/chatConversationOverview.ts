import type { RuntimeMessage, RuntimeToolRun } from '@setsuna-desktop/contracts';
import { latestFileChangeSummaryFromMessages, type RuntimeFileChangeSummary } from '../tool-runs/runtimeFileChanges.js';

export type ConversationPlanStatus = 'pending' | 'in_progress' | 'completed';

export type ConversationPlanItem = {
  step: string;
  status: ConversationPlanStatus;
};

export type ConversationOverviewState = {
  fileChangeSummary: RuntimeFileChangeSummary | null;
  planItems: ConversationPlanItem[];
  planRunning: boolean;
};

export function conversationOverviewFromMessages(
  messages: RuntimeMessage[],
  activeTurnId: string | null = null,
): ConversationOverviewState {
  const fileChangeSummary = latestFileChangeSummaryFromMessages(messages);
  const plan = latestPlanFromMessages(messages);
  return {
    fileChangeSummary: fileChangeSummary?.files.length ? fileChangeSummary : null,
    planItems: plan.items,
    // A saved in_progress step can outlive its turn. Only that plan's live turn
    // signals activity; a later follow-up must not restart an old plan's spinner.
    planRunning: Boolean(activeTurnId && plan.turnId === activeTurnId
      && plan.items.some((item) => item.status === 'in_progress')),
  };
}

export function latestPlanItemsFromMessages(messages: RuntimeMessage[]): ConversationPlanItem[] {
  return latestPlanFromMessages(messages).items;
}

function latestPlanFromMessages(messages: RuntimeMessage[]): { items: ConversationPlanItem[]; turnId: string | null } {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    const runs = message?.toolRuns ?? [];
    for (let runIndex = runs.length - 1; runIndex >= 0; runIndex -= 1) {
      const run = runs[runIndex];
      if (run?.name !== 'update_plan') continue;
      const plan = planItemsFromToolRun(run);
      if (plan.length) return { items: plan, turnId: message.turnId ?? null };
    }
  }
  return { items: [], turnId: null };
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
