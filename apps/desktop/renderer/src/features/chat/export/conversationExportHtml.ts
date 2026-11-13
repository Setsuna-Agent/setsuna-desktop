import { createElement, type HTMLAttributes } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderMermaidDiagram } from '@setsuna-desktop/renderer-ui';
import type { AppLocale } from '../../../shared/i18n/I18nProvider.js';
import type { ConversationExportDocument } from './conversationExportContent.js';
import { namespaceMarkdownReferences } from './conversationExportAnchors.js';
import { splitOpenUiContent, type OpenUiContentPart } from '../generative-ui/openUiContent.js';
import { separateOpenUiDisplayScopes, type OpenUiMarkdownRoot } from '../generative-ui/openUiMarkdownScopes.js';
import styles from './conversationExport.css?inline';

export async function conversationExportHtml(content: ConversationExportDocument, locale: AppLocale, format: 'html' | 'png' = 'html'): Promise<string> {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const signal = new AbortController().signal;
  const sections: string[] = [];
  const openUiStyles = new Set<string>();
  for (const [index, entry] of content.entries.entries()) {
    const rendered = await renderMarkdown(entry.content, theme, signal, entry.role === 'assistant', `message-${index + 1}`);
    if (rendered.openUiStyles) openUiStyles.add(rendered.openUiStyles);
    sections.push(`<section class="message message--${entry.role}">
<h2 class="message__role">${escapeHtml(entry.heading)}</h2>
<div class="message__body chat-markdown">${rendered.html}</div>
</section>`);
  }
  return `<!doctype html>
<html lang="${locale}" data-theme="${theme}" data-export-format="${format}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(content.title)}</title>
<style>${styles}\n${[...openUiStyles].join('\n')}</style>
</head>
<body><main><header class="document-header"><h1>${escapeHtml(content.title)}</h1></header>
${sections.join('\n')}
</main></body>
</html>\n`;
}

const exportComponents: Components = { div: ({ node, children, ...props }) => {
  const index = node?.properties.dataOpenuiBlock;
  const attributes: HTMLAttributes<HTMLDivElement> & { 'data-export-openui'?: number } =
    typeof index === 'number' ? { 'data-export-openui': index } : props;
  return createElement('div', attributes, children);
} };

async function renderMarkdown(content: string, theme: 'light' | 'dark', signal: AbortSignal, allowOpenUi: boolean, anchorPrefix: string): Promise<{ html: string; openUiStyles?: string }> {
  const source = content.replace(/\r\n?/gu, '\n');
  const blocks = allowOpenUi ? splitOpenUiContent(source).filter(
    (part): part is Extract<OpenUiContentPart, { kind: 'openui' }> => part.kind === 'openui' && part.closed,
  ) : [];
  const template = document.createElement('template');
  template.innerHTML = renderToStaticMarkup(createElement(ReactMarkdown, {
    skipHtml: true,
    components: exportComponents,
    remarkPlugins: [remarkGfm],
    rehypePlugins: [() => (tree: OpenUiMarkdownRoot) => separateOpenUiDisplayScopes(tree, blocks)],
    urlTransform: (url, key) => key === 'src' && /^data:image\/(png|jpeg|gif|webp);base64,/iu.test(url)
      ? url : defaultUrlTransform(url),
  }, source));
  // Scope Markdown references before adding components and their independently scoped SVG IDs.
  namespaceMarkdownReferences(template.content, anchorPrefix);
  let openUiStyles: string | undefined;
  for (const placeholder of template.content.querySelectorAll('[data-export-openui]')) {
    const block = blocks[Number(placeholder.getAttribute('data-export-openui'))];
    if (!block) continue;
    const { renderOpenUiExport } = await import('./openUiExport.js');
    const snapshot = await renderOpenUiExport(block.content, theme);
    if (snapshot) {
      openUiStyles = snapshot.styles;
      placeholder.replaceWith(snapshot.element);
    } else {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'language-openui';
      code.textContent = block.content;
      pre.appendChild(code);
      placeholder.className = 'chat-markdown';
      placeholder.removeAttribute('data-export-openui');
      placeholder.appendChild(pre);
    }
  }
  for (const code of template.content.querySelectorAll('pre > code.language-mermaid')) {
    try {
      const src = await renderMermaidDiagram(code.textContent ?? '', theme, signal);
      if (!src) continue;
      const figure = document.createElement('figure');
      figure.className = 'diagram';
      const image = document.createElement('img');
      image.src = src;
      image.alt = 'Mermaid';
      figure.appendChild(image);
      // Embed the rendered image, so the saved document needs no scripts or network.
      code.parentElement?.replaceWith(figure);
    } catch {
      // Match the chat renderer: preserve the source of malformed diagrams.
    }
  }
  return { html: template.innerHTML, openUiStyles };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
