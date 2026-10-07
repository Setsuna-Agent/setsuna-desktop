import type { ReactNode } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { ChatTurnNavigationRequest } from '@setsuna-desktop/renderer-contracts/chat';
import { Button } from '@setsuna-desktop/renderer-ui';
import type { AutomationClient } from './client.js';
import { TaskEditor } from './TaskEditor.js';
import { AutomationStarter, AutomationStarterSuggestions } from './AutomationStarter.js';
import { AutomationActivity } from './AutomationActivity.js';
import { useAutomationPage } from './useAutomationPage.js';
import { AutomationTaskRow } from './AutomationTaskRow.js';
import { useAutomationTaskActions } from './useAutomationTaskActions.js';
import { createAutomationToolbar, type AutomationToolbarProps } from './task-toolbar.js';
import { AutomationCreateMenu } from './AutomationCreateMenu.js';
import type { AutomationRendererHost } from './host.js';

export function AutomationPage({ client, threadId, openConversation, onSelectStarterPrompt, renderConversation, renderToolbar, ModelPicker, translate: t, locale }: {
  client: AutomationClient; threadId?: string; openConversation(threadId: string): Promise<boolean>;
  onSelectStarterPrompt(prompt: string): void;
  ModelPicker: AutomationRendererHost['ModelPicker'];
  renderToolbar(props: AutomationToolbarProps): ReactNode;
  renderConversation(starterContent?: ReactNode, starterFooter?: ReactNode, turnNavigationRequest?: ChatTurnNavigationRequest): ReactNode;
  translate: RendererTranslate; locale: string;
}) {
  const page = useAutomationPage(client, threadId, openConversation);
  const actions = useAutomationTaskActions(client, page.perform, t);
  const task = page.selectedTask;
  return <main className="automation-page">
    {task ? renderToolbar(createAutomationToolbar(task, page.busy, actions, t)) : null}
    <aside className="automation-sidebar">
      <header className="automation-sidebar__header"><h2>{t('feature.automation.title')}</h2>
        <AutomationCreateMenu busy={page.busy} translate={t} onCreateChat={() => void page.newConversation()}
          onCreateForm={() => void actions.create(task ? undefined : page.conversationId ?? undefined)} />
      </header>
      <div className="automation-sidebar__tasks">
        {page.snapshot.tasks.map((item) => <AutomationTaskRow key={item.id} task={item} active={page.selectedRunId === null && item.id === task?.id} busy={page.busy} actions={actions} onSelect={page.select} translate={t} locale={locale} />)}
      </div>
      <AutomationActivity entries={page.activity} selectedRunId={page.selectedRunId} translate={t} locale={locale} onSelect={page.select} />
    </aside>
    <section className="automation-main">
      {page.error ? <div className="automation-error" role="alert">{page.error}<Button variant="ghost" disabled={page.busy} onClick={page.retry}>{t('feature.automation.retry')}</Button></div> : null}
      <div className="automation-conversation">
        {page.conversationId && threadId === page.conversationId ? renderConversation(
          task ? undefined : <AutomationStarter translate={t} />,
          task ? undefined : <AutomationStarterSuggestions translate={t} onSelect={onSelectStarterPrompt} />,
          page.turnNavigationRequest,
        ) : <div className="automation-loading" role="status">{t('feature.automation.loading')}</div>}
      </div>
    </section>
    {actions.editor ? <TaskEditor task={actions.editor.task} threadId={actions.editor.threadId} client={client} models={page.snapshot.models} projects={page.snapshot.projects} ModelPicker={ModelPicker} translate={t} onClose={actions.closeEditor} onSaved={() => { void page.perform(async () => undefined); }} /> : null}
  </main>;
}
