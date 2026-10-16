import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { Paperclip } from 'lucide-react';
import { useI18n } from '../../../../shared/i18n/I18nProvider.js';
import { ChatPromptInput } from '../../composer/editor/ChatPromptInput.js';
import { ChatAttachmentTray } from '../../composer/ChatAttachmentTray.js';
import { ChatComposerOverlays } from '../../composer/ChatComposerOverlays.js';
import { useChatThreadId } from '../ChatThreadProvider.js';
import { useUserMessageEditor, type UserMessageEditorProps } from './useUserMessageEditor.js';

export function UserMessageEditor(props: UserMessageEditorProps) {
  const { t } = useI18n();
  const threadId = useChatThreadId();
  const editor = useUserMessageEditor(props);
  const { commands, attachments, locked } = editor;
  return (
    <article className="chat-bubble-item chat-bubble-item--user" data-message-id={props.message.id}>
      <div className="chat-user-edit" {...editor.clipboard}>
        <input className="chat-sender__file-input" ref={editor.fileInputRef} type="file" multiple tabIndex={-1} aria-hidden="true"
          disabled={locked || attachments.atLimit}
          onChange={(event) => { editor.addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />
        <ChatComposerOverlays
          mentionMenu={{ activeIndex: commands.activeMentionIndex, items: commands.mentionItems, hasProject: Boolean(props.activeProject),
            loadError: commands.loadError, loading: commands.loading, open: !locked && commands.mentionMenuOpen,
            onHover: commands.setActiveMentionIndex, onSelect: editor.selectMention }}
          slashMenu={{ activeIndex: commands.activeSlashIndex, items: editor.slashEntries, open: !locked && commands.slashMenuOpen,
            onHover: commands.setActiveSlashIndex, onSelect: editor.selectSlash }}
        />
        <ChatPromptInput ref={editor.editorRef} value={editor.draft} slotConfig={editor.initialSlots} disabled={locked}
          autoSize={{ minRows: 2, maxRows: 8 }} allowEmptySubmit={Boolean(attachments.sendableAttachments.length)}
          aria-label={t('chat.message.edit')} onChange={editor.onChange} onSubmit={editor.submit}
          onFocus={commands.handleComposerFocus} onBlur={commands.handleComposerBlur}
          onKeyDown={editor.onKeyDown} onKeyUp={commands.updateCursorOffset}
          onPasteFile={(files) => editor.addFiles(Array.from(files))}
          header={<ChatAttachmentTray disabled={locked} items={attachments.items} onRemove={attachments.remove} threadId={threadId} />}
          footer={() => (
            <div className="chat-user-edit__footer">
              <IconButton label={t('chat.composer.uploadAttachment')} disabled={locked || attachments.atLimit} onClick={() => editor.fileInputRef.current?.click()}>
                <Paperclip size={16} />
              </IconButton>
              <span className="chat-user-edit__actions">
                <Button variant="ghost" disabled={locked} onClick={props.onCancel}>{t('common.cancel')}</Button>
                <Button variant="primary" type="submit" disabled={locked || attachments.busy || (!editor.draft.trim() && !attachments.sendableAttachments.length)} onClick={() => void editor.submit()}>
                  {props.submitting ? t('chat.message.sending') : t('chat.composer.send')}
                </Button>
              </span>
            </div>
          )}
        />
      </div>
    </article>
  );
}
