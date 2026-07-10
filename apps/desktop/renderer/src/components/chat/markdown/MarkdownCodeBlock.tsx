import { useEffect, useRef, useState } from 'react';
import { CodeHighlighter } from '@ant-design/x';
import { copyTextToClipboard } from '../../../utils/clipboard.js';

type MarkdownCodeBlockProps = {
  code: string;
  language?: string;
};

const codeHighlighterHighlightProps = {
  codeTagProps: {
    style: {
      background: 'transparent',
      margin: 0,
    },
  },
  customStyle: {
    background: 'var(--chat-code-highlighter-bg)',
    margin: 0,
    padding: '18px 16px',
  },
  useInlineStyles: false,
};

const codeHighlighterStyle = { margin: '12px 0' };
const codeHighlighterStyles = {
  code: {
    background: 'var(--chat-code-highlighter-bg)',
  },
};

const codeLanguageAliases: Record<string, string> = {
  cjs: 'javascript',
  cs: 'csharp',
  cts: 'typescript',
  htm: 'markup',
  html: 'markup',
  js: 'javascript',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  svg: 'markup',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'markup',
  xml: 'markup',
  yml: 'yaml',
  zsh: 'bash',
};

export function MarkdownCodeBlock({ code, language = '' }: MarkdownCodeBlockProps) {
  const copiedCode = code.replace(/\n$/, '');
  const normalizedLanguage = normalizeMarkdownCodeLanguage(language);
  return (
    <CodeHighlighter
      className="chat-code-highlighter"
      header={
        <div className="chat-code-highlighter__header">
          <span className="chat-code-highlighter__language">{codeLanguageLabel(language)}</span>
          <CodeCopyButton code={copiedCode} />
        </div>
      }
      highlightProps={codeHighlighterHighlightProps}
      lang={normalizedLanguage}
      prismLightMode={false}
      style={codeHighlighterStyle}
      styles={codeHighlighterStyles}
    >
      {copiedCode}
    </CodeHighlighter>
  );
}

function CodeCopyButton({ code }: { code: string }) {
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
      aria-label={copied ? '代码已复制' : '复制代码'}
      onClick={() => void copyCode()}
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}

function codeLanguageLabel(language: string): string {
  return language.trim().toLowerCase() || 'plain text';
}

export function normalizeMarkdownCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return codeLanguageAliases[normalized] || normalized;
}
