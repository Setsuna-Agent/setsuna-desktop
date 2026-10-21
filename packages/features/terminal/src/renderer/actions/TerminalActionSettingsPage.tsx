import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsPageSlotProps } from '@setsuna-desktop/renderer-contracts/settings';
import { Button } from '@setsuna-desktop/renderer-ui';
import { useEffect } from 'react';
import type { TerminalAction } from '../../contracts/index.js';
import { useTerminalActionsHost } from './context.js';
import { TerminalActionCard } from './TerminalActionCard.js';
import { useTerminalActionDraft } from './useTerminalActionDraft.js';
import { useTerminalActions } from './useTerminalActions.js';
import './actions.css';

export function TerminalActionSettingsPage({ translate: t, ui }: SettingsPageSlotProps) {
  const host = useTerminalActionsHost();
  if (!host) return null;
  const selection = host.selection;
  if (!selection) return <ui.PageLayout title={t('feature.terminal.actions.environments')}>
    <ui.Section featureId="terminal">
      {host.projects.length > 0 ? <ui.Group>
        {host.projects.map((project) => <ui.NavigationRow key={project.id} label={project.name}
          onClick={() => host.selectProject(project)} />)}
      </ui.Group> : null}
    </ui.Section>
  </ui.PageLayout>;

  return <ui.PageLayout key={selection.project.id} title={selection.project.name} showHeading={false}
    parent={{ label: t('feature.terminal.actions.environments'), onBack: () => host.selectProject(null) }}>
    <ProjectActions projectId={selection.project.id} translate={t}
      initialAction={selection.draft} onDraftConsumed={host.consumeDraft} />
  </ui.PageLayout>;
}

function ProjectActions({ projectId, translate, initialAction, onDraftConsumed }: {
  projectId: string;
  translate: RendererTranslate;
  initialAction?: TerminalAction;
  onDraftConsumed(): void;
}) {
  const actions = useTerminalActions(projectId, translate);
  if (!actions.ready) return null;
  return <ActionEditor saved={actions.actions} onSave={actions.replace} translate={translate}
    initialAction={initialAction} onDraftConsumed={onDraftConsumed} />;
}

function ActionEditor({ saved, onSave, initialAction, onDraftConsumed, translate: t }: {
  saved: readonly TerminalAction[];
  onSave(actions: readonly TerminalAction[], base: readonly TerminalAction[]): boolean;
  initialAction?: TerminalAction;
  onDraftConsumed(): void;
  translate: RendererTranslate;
}) {
  const draft = useTerminalActionDraft(saved, onSave, initialAction);
  // The quick-add form hands its unsaved fields to this editor only once.
  useEffect(onDraftConsumed, [onDraftConsumed]);
  return <form className="feature-terminal-action-settings__editor" onSubmit={(event) => {
    event.preventDefault();
    if (draft.valid) draft.save();
  }}>
    <div className="feature-terminal-action-settings__heading">
      <h2>{t('feature.terminal.actions.title')}</h2>
      <Button size="small" onClick={draft.add}>{t('feature.terminal.actions.add')}</Button>
    </div>
    {draft.actions.map((action) => <TerminalActionCard key={action.id} action={action} translate={t}
      autoFocus={draft.focusId === action.id} onChange={draft.update} onRemove={() => draft.remove(action.id)} />)}
    <div className="feature-terminal-action-settings__footer">
      <Button variant="primary" size="small" type="submit" disabled={!draft.dirty || !draft.valid}>{t('feature.terminal.actions.save')}</Button>
    </div>
  </form>;
}
