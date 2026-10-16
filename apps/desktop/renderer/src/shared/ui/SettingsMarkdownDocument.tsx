import type { SettingsMarkdownDocumentProps } from '@setsuna-desktop/renderer-contracts/settings';
import { Button, DocumentMarkdown, IconButton } from '@setsuna-desktop/renderer-ui';
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../../app/providers/ToastProvider.js';
import { copyTextToClipboard } from '../lib/clipboard.js';

/** Plugin and Skill documents share the same sanitized reading surface as PR content. */
export function SettingsMarkdownDocument({ content, name, previewLabel, sourceLabel, copyLabels }: SettingsMarkdownDocumentProps) {
  const [source, setSource] = useState(false);
  return <article className="sd-markdown-document">
    <header>
      <h3>{name}</h3>
      <div className="sd-markdown-document__actions">
        {copyLabels ? <DocumentCopyButton content={content} labels={copyLabels} /> : null}
        <div className="sd-markdown-view-toggle" role="group" aria-label={name}>
          <Button variant="ghost" className="sd-markdown-view-option" aria-pressed={!source} onClick={() => setSource(false)}>{previewLabel}</Button>
          <Button variant="ghost" className="sd-markdown-view-option" aria-pressed={source} onClick={() => setSource(true)}>{sourceLabel}</Button>
        </div>
      </div>
    </header>
    {source ? <pre className="sd-markdown-document__source" tabIndex={0}>{content}</pre> : (
      <DocumentMarkdown className="sd-markdown-document__preview" content={markdownBody(content)} onOpenLink={(href) => {
        void window.setsunaDesktop?.links.openExternal(href).catch((error: unknown) => {
          console.error('[SettingsMarkdownDocument] failed to open link', error);
        });
      }} />
    )}
  </article>;
}

function DocumentCopyButton({ content, labels }: {
  content: string;
  labels: NonNullable<SettingsMarkdownDocumentProps['copyLabels']>;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await copyTextToClipboard(content);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      toast.error(labels.failed);
    }
  };

  return <IconButton label={copied ? labels.copied : labels.copy} onClick={() => void copy()}>
    {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
  </IconButton>;
}

function markdownBody(content: string): string {
  const frontmatter = content.match(/^\uFEFF?---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/u);
  return frontmatter?.[1] && /^(?:[A-Za-z_][\w.-]*):(?:[\t ]|$)/mu.test(frontmatter[1])
    ? content.slice(frontmatter[0].length)
    : content;
}
