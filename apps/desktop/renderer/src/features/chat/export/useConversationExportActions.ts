import { useToast } from '@setsuna-desktop/renderer-ui';
import type { DesktopConversationExportResult } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { copyTextToClipboard } from '../../../shared/lib/clipboard.js';
import type { ConversationExportPreview } from './exportConversation.js';

type ExportAction = 'copy' | 'save' | 'open' | 'reveal';

export function useConversationExportActions(preview: ConversationExportPreview | null) {
  const { t } = useI18n();
  const toast = useToast();
  const requests = useIdentityRequestGuard(preview?.file.path ?? '');
  const pending = useRef(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  const [busy, setBusy] = useState<ExportAction | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedFile, setSavedFile] = useState<{ name: string; path: string } | null>(null);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const run = useCallback(async (action: ExportAction) => {
    if (!preview || pending.current) return;
    const desktop = window.setsunaDesktop?.desktop;
    if (!desktop) { toast.error(t('chat.export.unavailable')); return; }
    const isCurrent = requests.begin();
    pending.current = true;
    setBusy(action);
    try {
      const { input, markdown } = preview;
      const file = { ...preview.file, ...savedFile };
      const image = file.imageDataUrl ? { dataUrl: file.imageDataUrl, name: file.name } : null;
      let result: DesktopConversationExportResult = { ok: true };
      if (action === 'copy') {
        if (image) result = await desktop.copyImageToClipboard(image);
        else if (file.format === 'html' && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([input.content], { type: 'text/html' }),
            'text/plain': new Blob([markdown], { type: 'text/plain' }),
          })]);
        } else await copyTextToClipboard(markdown);
      } else if (action === 'save') {
        // Save the prepared snapshot, even if the conversation changes behind this dialog.
        result = await desktop.savePreparedConversationExport(file.id);
      } else {
        result = action === 'open' ? await desktop.openPath(file.path) : await desktop.revealPath(file.path);
      }
      if (!isCurrent()) return;
      if (!result.ok) throw new Error(result.error);
      if (result.cancelled) return;
      if (action === 'copy') {
        setCopied(true);
        clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1600);
      } else if (action === 'save') {
        if (result.file) setSavedFile(result.file);
        toast.success(t('chat.export.saved'));
      }
    } catch (error) {
      if (isCurrent()) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      if (isCurrent()) setBusy(null);
    }
  }, [preview, requests, savedFile, t, toast]);
  return { busy, copied, run, file: preview ? { ...preview.file, ...savedFile } : null };
}
