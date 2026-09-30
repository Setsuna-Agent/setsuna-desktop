import { Clock3 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@setsuna-desktop/renderer-ui';
import type { ChatToolResultViewProps } from '@setsuna-desktop/renderer-contracts/chat';
import type { AutomationSnapshot, AutomationTask } from '../contracts/index.js';
import type { AutomationClient } from './client.js';
import { formatSchedule } from './format.js';
import { TaskEditor } from './TaskEditor.js';
import type { AutomationRendererHost } from './host.js';

export function TaskResultCard({ payload, translate: t, client, ModelPicker }: ChatToolResultViewProps<AutomationTask> & { client: AutomationClient; ModelPicker: AutomationRendererHost['ModelPicker'] }) {
  const [editor, setEditor] = useState<Pick<AutomationSnapshot, 'models' | 'projects'> & { task: AutomationTask } | null>(null);
  const [task, setTask] = useState(payload);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const open = async () => {
    setLoading(true); setError(null);
    try {
      const snapshot = await client.snapshot();
      const latest = snapshot.tasks.find((task) => task.id === payload.id);
      if (!latest) throw new Error(t('feature.automation.unavailable'));
      setTask(latest); setEditor({ task: latest, models: snapshot.models, projects: snapshot.projects });
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  };
  return <><div className="automation-result-card"><span className="automation-result-card__icon"><Clock3 size={20} /></span><div><strong>{task.title}</strong><span>{formatSchedule(task.schedule, t, navigator.language)}</span></div><Button size="small" loading={loading} onClick={() => void open()}>{t('feature.automation.open')}</Button></div>
    {error ? <p className="automation-error" role="alert">{error}</p> : null}
    {editor ? <TaskEditor task={editor.task} threadId={editor.task.conversationThreadId} client={client} models={editor.models} projects={editor.projects} ModelPicker={ModelPicker} translate={t} onClose={() => setEditor(null)} onSaved={setTask} /> : null}
  </>;
}
