import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const highlightLanguages = {
  bash,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  java,
  javascript,
  json,
  kotlin,
  less,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

Object.entries(highlightLanguages).forEach(([name, language]) => {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
});

hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx', 'mts', 'cts', 'vue'], { languageName: 'typescript' });
hljs.registerAliases(['html', 'htm', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['sh', 'zsh', 'fish'], { languageName: 'bash' });
hljs.registerAliases(['md', 'mdx'], { languageName: 'markdown' });
hljs.registerAliases(['rs'], { languageName: 'rust' });
hljs.registerAliases(['kt'], { languageName: 'kotlin' });
hljs.registerAliases(['cs'], { languageName: 'csharp' });

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
  jsx: 'javascript',
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
  tsx: 'typescript',
  vue: 'typescript',
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
  if (!language || !hljs.getLanguage(language)) return Array<string | undefined>(lineCount).fill(undefined);
  try {
    return splitHighlightedHtmlByLine(hljs.highlight(source, { language, ignoreIllegals: true }).value, lineCount);
  } catch {
    return Array<string | undefined>(lineCount).fill(undefined);
  }
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
