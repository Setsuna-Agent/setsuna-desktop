import type { SettingsMarkdownDocumentProps } from '@setsuna-desktop/renderer-contracts/settings';
import { Button } from '@setsuna-desktop/renderer-ui';
import { useState } from 'react';
import { DocumentMarkdown } from './DocumentMarkdown.js';

/** Plugin and Skill documents share the same sanitized reading surface as PR content. */
export function SettingsMarkdownDocument({ content, name, previewLabel, sourceLabel }: SettingsMarkdownDocumentProps) {
  const [source, setSource] = useState(false);
  return <article className="sd-markdown-document">
    <header>
      <h3>{name}</h3>
      <div className="sd-markdown-document__view-switch" role="group" aria-label={name}>
        <Button variant="ghost" aria-pressed={!source} onClick={() => setSource(false)}>{previewLabel}</Button>
        <Button variant="ghost" aria-pressed={source} onClick={() => setSource(true)}>{sourceLabel}</Button>
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

function markdownBody(content: string): string {
  const frontmatter = content.match(/^\uFEFF?---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/u);
  return frontmatter?.[1] && /^(?:[A-Za-z_][\w.-]*):(?:[\t ]|$)/mu.test(frontmatter[1])
    ? content.slice(frontmatter[0].length)
    : content;
}
