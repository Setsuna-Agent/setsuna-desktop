import { Actions, CodeHighlighter } from '@ant-design/x';

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
    padding: '16px',
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
          <span className="chat-code-highlighter__language">{(language || 'text').toUpperCase()}</span>
          <Actions.Copy text={copiedCode} />
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

export function normalizeMarkdownCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return codeLanguageAliases[normalized] || normalized;
}
