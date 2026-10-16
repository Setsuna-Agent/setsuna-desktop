import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, ConfirmDialogTrigger } from '@setsuna-desktop/renderer-ui';
import { useState } from 'react';
import type { ProcessResourceSample, ResourceProcessTarget, RuntimeActivityDesktopBridge } from '../contracts/index.js';

export function ResourceProcessTerminateButton({ process, desktopBridge, onTerminated, translate: t }: {
  process: ProcessResourceSample;
  desktopBridge: RuntimeActivityDesktopBridge | null;
  onTerminated(): void;
  translate: RendererTranslate;
}) {
  const [target, setTarget] = useState<ResourceProcessTarget | null>(null);
  const disabled = !process.canTerminate || !desktopBridge;
  return <ConfirmDialogTrigger danger disabled={disabled}
    title={t('feature.runtimeActivity.resources.confirmTerminate', { pid: process.pid })}
    description={t('feature.runtimeActivity.resources.terminateImpact', { count: target?.pageIds.length ?? process.pages.length })}
    confirmLabel={t('feature.runtimeActivity.action.stop')}
    onConfirm={async () => {
      if (!desktopBridge || !target) return;
      if (target.pid !== process.pid || target.startedAt !== process.startedAt
        || target.pageIds.length !== process.pages.length || process.pages.some(page => !target.pageIds.includes(page.id))) {
        throw new Error(t('feature.runtimeActivity.resources.stale'));
      }
      const result = await desktopBridge.terminateResourceProcess(target);
      onTerminated();
      if (result !== 'terminated') throw new Error(t(`feature.runtimeActivity.resources.${result}`));
    }}>
    <Button variant="ghost" className="runtime-activity-row__action" disabled={disabled}
      aria-label={t('feature.runtimeActivity.resources.terminate', { pid: process.pid })}
      onClick={() => {
        // Polling can replace page membership without replacing this row or its open dialog.
        setTarget({ pid: process.pid, startedAt: process.startedAt, pageIds: process.pages.map(page => page.id) });
      }}>
      {t('feature.runtimeActivity.action.stop')}
    </Button>
  </ConfirmDialogTrigger>;
}
