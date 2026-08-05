import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CodeFileView } from '../../../shared/code/PierreCode.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { copyTextToClipboard } from '../../../shared/lib/clipboard.js';

type MarkdownCodeBlockProps = {
  code: string;
  language?: string;
};

const maxHighlightedCodeCharacters = 24_000;
const maxHighlightedCodeLines = 500;
const chatCodeSurfaceStyle = {
  '--diffs-dark-bg': 'var(--app-surface-muted)',
  '--diffs-font-size': '13px',
  '--diffs-light-bg': 'var(--app-surface-muted)',
  '--diffs-line-height': '21px',
} as CSSProperties;
const chatCodeUnsafeCSS = '[data-code] { padding-top: 2px; padding-bottom: 4px; }';

const codeLanguageAliases: Record<string, string> = {
  cjs: 'javascript',
  cs: 'csharp',
  cts: 'typescript',
  htm: 'html',
  js: 'javascript',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  svg: 'xml',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
};

const codeLanguageDisplayNames: Record<string, string> = {
  bash: 'Bash',
  csharp: 'C#',
  css: 'CSS',
  html: 'HTML',
  javascript: 'JavaScript',
  jsx: 'JSX',
  json: 'JSON',
  markdown: 'Markdown',
  python: 'Python',
  rust: 'Rust',
  text: 'Plain Text',
  tsx: 'TSX',
  typescript: 'TypeScript',
  vue: 'Vue',
  xml: 'XML',
  yaml: 'YAML',
};

export function MarkdownCodeBlock({ code, language = '' }: MarkdownCodeBlockProps) {
  const copiedCode = normalizeMarkdownCodeBlockContents(code);
  const normalizedLanguage = normalizeMarkdownCodeLanguage(language);
  const shouldHighlight = normalizedLanguage.length > 0 && shouldSyntaxHighlightMarkdownCode(copiedCode);
  return (
    <div className={`chat-code-highlighter ${shouldHighlight ? '' : 'chat-code-highlighter--plain'}`.trim()}>
      <CodeBlockHeader code={copiedCode} language={language} />
      <CodeFileView
        contents={copiedCode}
        disableBackground
        language={shouldHighlight ? normalizedLanguage : 'text'}
        name={`snippet.${normalizedLanguage || 'txt'}`}
        showLineNumbers={false}
        style={chatCodeSurfaceStyle}
        unsafeCSS={chatCodeUnsafeCSS}
      />
    </div>
  );
}

export function normalizeMarkdownCodeBlockContents(code: string): string {
  return code.replace(/(?:\r?\n[\t ]*)+$/, '');
}

function CodeBlockHeader({ code, language }: { code: string; language: string }) {
  return (
    <div className="chat-code-highlighter__header">
      <span className="chat-code-highlighter__language">{codeLanguageLabel(language)}</span>
      <CodeCopyButton code={code} />
    </div>
  );
}

function CodeCopyButton({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  const copyCode = async () => {
    try {
      await copyTextToClipboard(code);
      setCopied(true);
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      className={copied ? 'chat-code-highlighter__copy is-copied' : 'chat-code-highlighter__copy'}
      type="button"
      aria-label={copied ? t('chat.markdown.codeCopied') : t('chat.markdown.copyCode')}
      onClick={() => void copyCode()}
    >
      {copied
        ? <Check aria-hidden="true" className="chat-code-highlighter__copy-icon" size={14} />
        : <Copy aria-hidden="true" className="chat-code-highlighter__copy-icon" size={14} />}
      <span className="chat-code-highlighter__copy-label">
        {copied ? t('chat.markdown.copied') : t('chat.markdown.copy')}
      </span>
    </button>
  );
}

function codeLanguageLabel(language: string): string {
  const normalized = normalizeMarkdownCodeLanguage(language);
  return codeLanguageDisplayNames[normalized] ?? (normalized || 'Plain Text');
}

export function normalizeMarkdownCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return codeLanguageAliases[normalized] || normalized;
}

export function shouldSyntaxHighlightMarkdownCode(code: string): boolean {
  if (code.length > maxHighlightedCodeCharacters) return false;
  let lineCount = 1;
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) !== 10) continue;
    lineCount += 1;
    if (lineCount > maxHighlightedCodeLines) return false;
  }
  return true;
}
