import type { DesktopRuntimeClient, RuntimeMessage } from '@setsuna-desktop/contracts';
import type { RuntimeArtifact } from '@setsuna-desktop/feature-artifact/contracts';
import { useArtifactNavigation } from '../../../composition/ArtifactFeatureBoundary.js';
import { chatDesignTitle } from '@setsuna-desktop/feature-design/contracts';
import { Button, useToast } from '@setsuna-desktop/renderer-ui';
import { File, PanelsTopLeft } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useOpenChatDesign } from '../mentions/ChatDesignReference.js';
import { useConversationArtifacts } from './useConversationArtifacts.js';

export function ConversationArtifactGroup({ client, threadId, messages, before }: {
  client: Pick<DesktopRuntimeClient, 'listThreadMessages'>; threadId: string; messages: readonly RuntimeMessage[]; before: number | null;
}) {
  const entries = useConversationArtifacts(client, threadId, messages, before);
  const openDesign = useOpenChatDesign();
  const navigation = useArtifactNavigation();
  const { t } = useI18n();
  const toast = useToast();
  async function openFile(file: RuntimeArtifact) {
    try {
      if (navigation?.projectId === file.projectId && navigation.onShowInFiles) {
        await navigation.onShowInFiles(file.workspaceRoot + '/' + file.path);
        return;
      }
      const result = await window.setsunaDesktop?.desktop.openWorkspaceFile(file.workspaceRoot, file.path);
      if (!result?.ok) throw new Error(result?.error || t('feature.artifact.openFailed'));
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  }
  if (!entries.length) return null;
  return <>
    <div className="chat-conversation-overview-panel__divider" />
    <section className="chat-conversation-overview-panel__artifacts" aria-label={t('conversation.overview.artifacts')}>
      <h3>{t('conversation.overview.artifacts')}</h3>
      <div>{entries.map(([key, entry]) => {
        const design = entry.kind === 'design';
        const title = design ? chatDesignTitle(entry.design) : entry.file.name;
        return <Button key={key} type="button" variant="ghost" className="chat-conversation-overview-panel__row"
          title={design ? entry.design.ref.path : entry.file.path} disabled={design && !openDesign}
          onClick={() => design ? openDesign?.(entry.design) : void openFile(entry.file)}>
          <span className="chat-conversation-overview-panel__icon">{design ? <PanelsTopLeft size={14} /> : <File size={14} />}</span>
          <span className="chat-conversation-overview-panel__label">{title}</span>
        </Button>;
      })}</div>
    </section>
  </>;
}
