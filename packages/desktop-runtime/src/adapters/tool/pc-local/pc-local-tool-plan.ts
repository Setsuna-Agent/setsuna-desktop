import { recordInput } from '../../../shared/unknown.js';
import { errorResult, okResult, shortSingleLine } from './pc-local-tool-utils.js';

export type LocalPlanStatus = 'pending' | 'in_progress' | 'completed';

export type LocalPlanItem = {
  step: string;
  status: LocalPlanStatus;
};

export function updatePlan(args: Record<string, unknown>) {
  const plan = normalizePlanItems(args.plan);
  if (!plan.length) return errorResult('请提供至少一个计划步骤。');
  const inProgressCount = plan.filter((item) => item.status === 'in_progress').length;
  if (inProgressCount > 1) return errorResult('任务计划最多只能有一个 in_progress 步骤。');
  const explanation = shortSingleLine(args.explanation || '', 240);
  const completedCount = plan.filter((item) => item.status === 'completed').length;
  const activeStep = plan.find((item) => item.status === 'in_progress')?.step || '';
  const lines = plan.map((item) => `${planStatusMarker(item.status)} ${item.step}`);
  return okResult(
    [explanation ? `Note: ${explanation}` : '', 'Task plan:', ...lines].filter(Boolean).join('\n'),
    activeStep ? `计划更新：${activeStep}` : `计划更新：${completedCount}/${plan.length} 已完成`,
    {
      explanation,
      plan,
      plan_summary: {
        total: plan.length,
        completed: completedCount,
        in_progress: inProgressCount,
        pending: plan.filter((item) => item.status === 'pending').length,
        active_step: activeStep,
      },
    },
  );
}

export function normalizePlanItems(value: unknown): LocalPlanItem[] {
  if (!Array.isArray(value)) return [];
  const plan: LocalPlanItem[] = [];
  for (const item of value) {
    const record = recordInput(item);
    const step = shortSingleLine(record.step || record.text || record.title || '', 180);
    if (step) plan.push({ step, status: normalizePlanStatus(record.status) });
    if (plan.length >= 12) break;
  }
  return plan;
}

function normalizePlanStatus(value: unknown): LocalPlanStatus {
  const status = String(value || '').trim();
  return status === 'in_progress' || status === 'completed' ? status : 'pending';
}

function planStatusMarker(status: LocalPlanStatus): string {
  if (status === 'completed') return '[x]';
  if (status === 'in_progress') return '[>]';
  return '[ ]';
}
