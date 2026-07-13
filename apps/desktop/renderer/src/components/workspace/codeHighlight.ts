import { refractor } from 'refractor';
import docker from 'refractor/docker';
import jsx from 'refractor/jsx';
import tsx from 'refractor/tsx';

[docker, jsx, tsx].forEach((language) => {
  if (!refractor.registered(language.displayName)) refractor.register(language);
});

const fileLanguageByExtension: Record<string, string> = {
  bash: 'bash',
  c: 'cpp',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cts: 'typescript',
  diff: 'diff',
  dockerfile: 'dockerfile',
  go: 'go',
  h: 'cpp',
  hpp: 'cpp',
  htm: 'xml',
  html: 'xml',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  less: 'less',
  m: 'cpp',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sass: 'scss',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svg: 'xml',
  swift: 'swift',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'tsx',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

const fileLanguageByName: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'bash',
};

export function fileLanguage(filePath: string): string {
  const normalized = filePath.trim().toLowerCase().replace(/\\/g, '/');
  const name = normalized.split('/').pop() || '';
  if (fileLanguageByName[name]) return fileLanguageByName[name];
  const extension = name.includes('.') ? name.split('.').pop() || '' : name;
  return fileLanguageByExtension[extension] || '';
}

export function highlightedCodeLinesHtml(source: string, language: string): Array<string | undefined> {
  const lineCount = source.split('\n').length;
  if (!language || !refractor.registered(language)) return Array<string | undefined>(lineCount).fill(undefined);
  try {
    return splitHighlightedHtmlByLine(serializeHighlightedTree(refractor.highlight(source, language)), lineCount);
  } catch {
    return Array<string | undefined>(lineCount).fill(undefined);
  }
}

type HighlightedTree = ReturnType<typeof refractor.highlight>;
type HighlightedNode = HighlightedTree['children'][number];

function serializeHighlightedTree(tree: HighlightedTree): string {
  return tree.children.map(serializeHighlightedNode).join('');
}

function serializeHighlightedNode(node: HighlightedNode): string {
  if (node.type === 'text') return escapeHighlightedText(node.value);
  if (node.type !== 'element') return '';
  const classNames = Array.isArray(node.properties.className)
    ? node.properties.className.filter((value): value is string => typeof value === 'string')
    : [];
  const classAttribute = classNames.length ? ` class="${classNames.map(escapeHighlightedAttribute).join(' ')}"` : '';
  return `<span${classAttribute}>${node.children.map(serializeHighlightedNode).join('')}</span>`;
}

function escapeHighlightedText(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function escapeHighlightedAttribute(value: string): string {
  return escapeHighlightedText(value).replace(/"/gu, '&quot;');
}

function splitHighlightedHtmlByLine(html: string, lineCount: number): string[] {
  const lines: string[] = [];
  const openTags: string[] = [];
  let current = '';
  let index = 0;

  while (index < html.length) {
    if (html.startsWith('<span ', index)) {
      const tagEnd = html.indexOf('>', index);
      if (tagEnd !== -1) {
        const tag = html.slice(index, tagEnd + 1);
        current += tag;
        openTags.push(tag);
        index = tagEnd + 1;
        continue;
      }
    }

    if (html.startsWith('</span>', index)) {
      current += '</span>';
      openTags.pop();
      index += '</span>'.length;
      continue;
    }

    if (html[index] === '\n') {
      for (let tagIndex = openTags.length - 1; tagIndex >= 0; tagIndex -= 1) current += '</span>';
      lines.push(current);
      current = openTags.join('');
      index += 1;
      continue;
    }

    current += html[index];
    index += 1;
  }

  lines.push(current);
  while (lines.length < lineCount) lines.push('');
  return lines.slice(0, lineCount);
}
