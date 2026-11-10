import { useEffect, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useConfirm } from '@setsuna-desktop/renderer-ui';
import type { AssistantSidebarPatch, AssistantSidebarTarget } from '../contracts/index.js';
import type { AssistantsRendererService } from './client.js';
import type { AssistantSidebarEntry } from './sidebar-entries.js';
import { errorMessage } from './errors.js';

/** Captures the menu's target independently of the conversation currently open on the page. */
export function useAssistantSidebarActions({ service, deleteEntry, translate: t, onError }: {
  service: AssistantsRendererService;
  deleteEntry(target: AssistantSidebarTarget): Promise<void>;
  translate: RendererTranslate;
  onError(message: string | null): void;
}) {
  const [rename, setRename] = useState<{ entry: AssistantSidebarEntry; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const confirm = useConfirm();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = async (action: () => Promise<void>) => {
    if (pending.current || !mounted.current) return;
    pending.current = true;
    setBusy(true); onError(null);
    try { await action(); }
    catch (cause) { if (mounted.current) onError(errorMessage(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const update = async (entry: AssistantSidebarEntry, patch: AssistantSidebarPatch) => {
    await service.client.updateSidebarEntry(targetOf(entry), patch);
    await service.store.refresh();
  };
  const remove = async (entry: AssistantSidebarEntry) => {
    if (!entry.canDelete || pending.current || !mounted.current) return;
    if (!await confirm({
      title: t('feature.assistants.sidebar.deleteTitle', { title: entry.title }),
      description: t(entry.kind === 'reminder' ? 'feature.assistants.sidebar.deleteReminder' : 'feature.assistants.sidebar.deleteTask'),
      confirmLabel: t('feature.assistants.sidebar.delete'), danger: true,
    })) return;
    await run(() => deleteEntry(targetOf(entry)));
  };

  return {
    rename, busy,
    onRename(entry: AssistantSidebarEntry) { if (!pending.current) { onError(null); setRename({ entry, title: entry.title }); } },
    onTogglePin(entry: AssistantSidebarEntry) { void run(() => update(entry, { pinned: !entry.pinned })); },
    onDelete(entry: AssistantSidebarEntry) { void remove(entry); },
    changeTitle(title: string) { setRename((current) => current ? { ...current, title } : null); },
    closeRename() { if (!pending.current) setRename(null); },
    saveRename() {
      if (!rename?.title.trim()) return;
      void run(async () => {
        await update(rename.entry, { title: rename.title.trim() });
        if (mounted.current) setRename(null);
      });
    },
  };
}

function targetOf({ assistantId, kind, entryId }: AssistantSidebarEntry): AssistantSidebarTarget {
  return { assistantId, kind, entryId };
}
