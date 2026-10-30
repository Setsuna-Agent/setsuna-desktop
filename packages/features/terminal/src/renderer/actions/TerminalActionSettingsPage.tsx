import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { SettingsPageSlotProps, SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { Plus } from 'lucide-react';
import { useEffect } from 'react';
import type { TerminalAction } from '../../contracts/index.js';
import { useTerminalActionsHost } from './context.js';
import { TerminalActionDialog } from './TerminalActionDialog.js';
import { TerminalActionIcon } from './TerminalActionIcon.js';
import { useTerminalActionEditor } from './useTerminalActionEditor.js';
import { useTerminalActions } from './useTerminalActions.js';
import './actions.css';

export function TerminalActionSettingsPage({ translate: t, ui }: SettingsPageSlotProps) {
  const host = useTerminalActionsHost();
  if (!host) return null;
  const selection = host.selection;
  if (!selection) return <ui.PageLayout title={t('feature.terminal.actions.environments')}>
    <ui.Section featureId="terminal">
      {host.projects.length > 0 ? <ui.Group>
        {host.projects.map((project) => <ui.NavigationRow key={project.id} label={project.name} icon={project.iconNode}
          onClick={() => host.selectProject(project)} />)}
      </ui.Group> : null}
    </ui.Section>
  </ui.PageLayout>;

  return <ui.PageLayout key={selection.project.id} title={selection.project.name} showHeading={false}
    parent={{ label: t('feature.terminal.actions.environments'), onBack: () => host.selectProject(null) }}>
    <ProjectActions projectId={selection.project.id} translate={t} ui={ui}
      initialAction={selection.draft} onDraftConsumed={host.consumeDraft} />
  </ui.PageLayout>;
}

function ProjectActions({ projectId, translate, ui, initialAction, onDraftConsumed }: {
  projectId: string;
  translate: RendererTranslate;
  ui: SettingsViewUi;
  initialAction?: TerminalAction;
  onDraftConsumed(): void;
}) {
  const actions = useTerminalActions(projectId, translate);
  if (!actions.ready) return null;
  return <ActionList saved={actions.actions} onSave={actions.replace} translate={translate} ui={ui}
    initialAction={initialAction} onDraftConsumed={onDraftConsumed} />;
}

function ActionList({ saved, onSave, initialAction, onDraftConsumed, translate: t, ui }: {
  saved: readonly TerminalAction[];
  onSave(actions: readonly TerminalAction[], base: readonly TerminalAction[]): boolean;
  initialAction?: TerminalAction;
  onDraftConsumed(): void;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}) {
  const editor = useTerminalActionEditor(saved, onSave, initialAction);
  // The quick-add form hands its unsaved fields to this editor only once.
  useEffect(onDraftConsumed, [onDraftConsumed]);
  const heading = <div className="feature-terminal-action-settings__heading">
    <h2>{t('feature.terminal.actions.title')}</h2>
    <ui.Button variant="ghost" icon={<Plus size={14} />} onClick={editor.add}>{t('feature.terminal.actions.add')}</ui.Button>
  </div>;
  return <ui.Section featureId="terminal">
    {saved.length ? <ui.Group title={heading}>
      {saved.map((action) => <ui.NavigationRow key={action.id} label={action.name}
        icon={<TerminalActionIcon icon={action.icon} size={18} />} onClick={() => editor.open(action)} />)}
    </ui.Group> : heading}
    {editor.editing ? <TerminalActionDialog key={editor.editing.action.id} mode="settings" translate={t}
      action={editor.editing.action} creating={editor.editing.creating} onSave={editor.save}
      onRemove={editor.editing.creating ? undefined : editor.remove} onClose={editor.close} /> : null}
  </ui.Section>;
}
