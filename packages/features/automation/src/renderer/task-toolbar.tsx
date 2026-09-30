import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { IconButtonProps } from '@setsuna-desktop/renderer-ui';
import { Pause, Play, RotateCw, Settings2, Trash2 } from 'lucide-react';
import type { AutomationTask } from '../contracts/index.js';
import type { AutomationTaskActions } from './useAutomationTaskActions.js';

export type AutomationToolbarProps = {
  title: string;
  actions: readonly (IconButtonProps & { id: string })[];
};

/** The feature owns task actions; the host owns platform placement and presentation. */
export function createAutomationToolbar(
  task: AutomationTask,
  busy: boolean,
  actions: AutomationTaskActions,
  t: RendererTranslate,
): AutomationToolbarProps {
  const running = task.runs.some((run) => run.status === 'running');
  return {
    title: task.title,
    actions: [
      {
        id: 'edit', label: t('feature.automation.edit'), disabled: busy,
        onClick: () => actions.edit(task), children: <Settings2 />,
      },
      {
        id: 'status', label: t(task.status === 'active' ? 'feature.automation.pause' : 'feature.automation.resume'), disabled: busy,
        onClick: () => void actions.toggleStatus(task), children: task.status === 'active' ? <Pause /> : <Play />,
      },
      {
        id: 'run', label: t('feature.automation.run'), disabled: busy || running,
        onClick: () => void actions.run(task), children: <RotateCw />,
      },
      {
        id: 'delete', label: t('feature.automation.delete'), disabled: busy || running,
        onClick: () => void actions.remove(task), children: <Trash2 />,
      },
    ],
  };
}
