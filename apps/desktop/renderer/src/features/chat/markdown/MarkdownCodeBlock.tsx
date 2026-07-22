import { CodeHighlighter } from '@ant-design/x';
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { copyTextToClipboard } from '../../../shared/lib/clipboard.js';

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

const maxHighlightedCodeCharacters = 24_000;
const maxHighlightedCodeLines = 500;

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
  // lang 为空时，CodeHighlighter 会返回裸内联 <code>；因此没有语言标签的围栏代码块
  // 必须走受控的纯代码路径，以保留换行。
  const shouldHighlight = normalizedLanguage.length > 0 && shouldSyntaxHighlightMarkdownCode(copiedCode);
  if (!shouldHighlight) {
    return (
      <div className="chat-code-highlighter chat-code-highlighter--plain">
        <CodeBlockHeader code={copiedCode} language={language} />
        <div className="ant-codeHighlighter-code">
          <pre><code>{copiedCode}</code></pre>
        </div>
      </div>
    );
  }
  return (
    <CodeHighlighter
      className="chat-code-highlighter"
      header={<CodeBlockHeader code={copiedCode} language={language} />}
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

function CodeBlockHeader({ code, language }: { code: string; language: string }) {
  return (
    <div className="chat-code-highlighter__header">
      <span className="chat-code-highlighter__language">{codeLanguageLabel(language)}</span>
      <CodeCopyButton code={code} />
    </div>
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
      {copied
        ? <Check aria-hidden="true" className="chat-code-highlighter__copy-icon" size={14} />
        : <Copy aria-hidden="true" className="chat-code-highlighter__copy-icon" size={14} />}
      <span className="chat-code-highlighter__copy-label">{copied ? '已复制' : '复制'}</span>
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
