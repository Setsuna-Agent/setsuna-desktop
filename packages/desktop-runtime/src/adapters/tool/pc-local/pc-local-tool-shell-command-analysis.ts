import path from 'node:path';
import {
  SHELL_MUTATION_COMMANDS_WITH_PATH_ARGS,
  SHELL_READ_COMMANDS_WITH_PATH_ARGS,
} from './pc-local-tool-constants.js';

type ParsedShellCommandSegment = {
  words: string[];
  inputRedirects: string[];
  outputRedirects: string[];
};

export function normalizeShellCommandForRisk(command: unknown): string {
  return String(command || '')
    .replace(/\\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function obviousHighRiskShellReason(command: unknown): string {
  const text = String(command || '').toLowerCase();
  const words = text.split(/[^a-z0-9_.-]+/).filter(Boolean);
  const hasWord = (value: string) => words.includes(value);

  if (_usesShellApplyPatch(text)) return '命令会通过 apply_patch 修改工作区文件。';
  const dangerousReason = codexDangerousShellReason(text);
  if (dangerousReason) return dangerousReason;
  if (hasParsedDeletionCommand(text)) return '命令可能删除文件。';
  if (hasWord('rm') || hasWord('rmdir') || hasWord('unlink')) return '命令可能删除文件。';
  if (hasWord('mv') || hasWord('cp') || hasWord('touch') || hasWord('truncate')) return '命令可能修改工作区文件。';
  if (hasWord('chmod') || hasWord('chown') || hasWord('chgrp')) return '命令可能修改文件权限或归属。';
  if (hasWord('dd') || hasWord('mkfs') || hasWord('mount') || hasWord('umount')) return '命令可能影响磁盘或挂载状态。';
  if (/\bfind\b[\s\S]*\s-delete\b/.test(text)) return '命令可能删除文件。';
  if (/\b(?:python|python3|node|ruby|osascript)\b\s+(?:-[a-z]*c|-e)\b/.test(text)) {
    return '命令会执行内联脚本，可能修改本地环境。';
  }
  if (text.includes('git reset --hard') || text.includes('git clean')) return '命令可能丢弃 Git 改动。';
  if (/\bgit\s+(?:checkout|switch|restore|rebase|merge|commit|push|pull|stash|tag)\b/.test(text)) return '命令可能改变 Git 状态或远端仓库。';
  if (hasWord('sudo')) return '命令会提升权限。';
  if (
    /\b(?:pip3?|python(?:3(?:\.\d+)?)?\s+-m\s+pip)\s+install\b/.test(text)
    || /\buv\s+(?:add|sync|lock|tool\s+install|python\s+install|pip\s+install)\b/.test(text)
    || /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|update|upgrade|remove|uninstall)\b/.test(text)
    || /\b(?:cargo|gem|brew|apt(?:-get)?|dnf|yum|pacman)\s+install\b/.test(text)
  ) {
    return '命令会安装或修改本地依赖。';
  }
  if (/\b(?:npm|pnpm|yarn|bun|cargo|twine)\s+(?:publish|release)\b/.test(text)) return '命令可能发布包或版本。';
  if (/\b(?:vercel|netlify|firebase|wrangler)\s+(?:deploy|publish)\b/.test(text)) return '命令可能部署到线上环境。';
  if (/\b(?:docker|podman)\s+(?:rm|rmi|prune|system\s+prune|compose\s+down)\b/.test(text)) return '命令可能删除容器、镜像或卷。';
  if (/\b(?:scp|rsync|ssh)\b/.test(text)) return '命令可能访问或修改远程系统。';
  if (/(^|[^<=>])>{1,2}\s*(?!\/dev\/null(?:\s|$|[;&|]))[^&\s]/.test(text) || /\btee\s+/.test(text) || /\b(?:sed|perl)\s+[^|&;]*-i\b/.test(text)) {
    return '命令可能通过 shell 写入或改写文件。';
  }
  if ((hasWord('curl') || hasWord('wget')) && /\|\s*(?:sh|bash|zsh)\b/.test(text)) {
    return '命令会执行远程下载的脚本。';
  }
  return '';
}

const WINDOWS_DELETE_COMMAND = /(?:^|[;&|{(]\s*|(?:-command|\/command|\/c|\/r)\s+["']?)(remove-item|ri|rm|del|erase|rd|rmdir)\b/giu;

function windowsDeleteCommandTails(command: unknown): string[] {
  const text = String(command || '');
  const tails: string[] = [];
  for (const match of text.matchAll(WINDOWS_DELETE_COMMAND)) {
    const commandName = match[1];
    if (!commandName || match.index === undefined) continue;
    const commandOffset = match[0].toLowerCase().lastIndexOf(commandName.toLowerCase());
    tails.push(text.slice(match.index + commandOffset).split(/[;&|\r\n]/u, 1)[0] || '');
  }
  return tails;
}

function hasWindowsForceDeleteCommand(command: string): boolean {
  return windowsDeleteCommandTails(command).some((commandTail) => {
    const commandName = commandTail.match(/^\s*([a-z-]+)/iu)?.[1]?.toLowerCase() || '';
    const hasPowerShellForce = /(?:^|\s)-force(?::(?:\$?true|1))?(?=$|[\s"')\]},])/iu.test(commandTail);
    if (hasPowerShellForce) return true;
    if (commandName === 'del' || commandName === 'erase') {
      return /(?:^|\s)\/f(?=$|[\s"')\]},])/iu.test(commandTail);
    }
    if (commandName === 'rd' || commandName === 'rmdir') {
      return /(?:^|\s)\/s(?=$|[\s"')\]},])/iu.test(commandTail)
        && /(?:^|\s)\/q(?=$|[\s"')\]},])/iu.test(commandTail);
    }
    return false;
  });
}

/**
 * Mirrors the narrow destructive-command denylist used by Codex when approval
 * prompts are disabled. Broader mutation heuristics still only request approval.
 */
export function codexDangerousShellReason(command: unknown): string {
  const text = String(command || '');
  if (hasWindowsForceDeleteCommand(text)) {
    return '命令可能通过 Windows Shell 强制删除文件。';
  }
  return hasForcedRmCommand(text)
    ? '命令会使用 rm 强制删除文件。'
    : '';
}

function hasForcedRmCommand(command: string, depth = 0): boolean {
  if (depth > 8) return false;
  for (const segment of splitShellCommandSegments(command)) {
    const words = parseShellCommandSegment(segment).words;
    if (hasForcedRmWords(words, depth)) return true;
  }
  return false;
}

function hasForcedRmWords(words: readonly string[], depth: number): boolean {
  const commandName = shellCommandName(words[0]);
  if (commandName === 'rm') {
    for (const argument of words.slice(1)) {
      if (argument === '--') break;
      if (argument === '--force') return true;
      if (/^-[^-]*f/u.test(argument)) return true;
    }
    return false;
  }
  if (commandName === 'sudo') return hasForcedRmWords(words.slice(1), depth + 1);
  if (commandName === 'env') {
    const nested = words.slice(1).filter((word) => (
      word !== '-i'
      && word !== '--ignore-environment'
      && word !== '--'
      && !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word)
    ));
    return hasForcedRmWords(nested, depth + 1);
  }
  if (['bash', 'dash', 'ksh', 'sh', 'zsh'].includes(commandName)) {
    const scriptIndex = words.findIndex((word, index) => index > 0 && /^-[a-z]*c[a-z]*$/iu.test(word));
    const script = scriptIndex >= 0 ? words[scriptIndex + 1] : '';
    return script ? hasForcedRmCommand(script, depth + 1) : false;
  }
  return false;
}

function hasParsedDeletionCommand(command: string): boolean {
  for (const segment of splitShellCommandSegments(command)) {
    const words = parseShellCommandSegment(segment).words;
    if (['rm', 'rmdir', 'unlink'].includes(shellCommandName(words[0]))) return true;
  }
  return false;
}

export function _usesShellApplyPatch(text: string): boolean {
  return /(?:^|[;&|]\s*)(?:apply_patch|applypatch)\b/.test(text)
    || /\b(?:apply_patch|applypatch)\s*<</.test(text)
    || /<<[A-Z0-9_'-]*\s*\n?[^|&;]*(?:apply_patch|applypatch)\b/.test(text);
}

export function shellWritePathCandidates(command: unknown): string[] {
  const candidates: string[] = [];
  const text = String(command || '');

  for (const segment of splitShellCommandSegments(text)) {
    const parsed = parseShellCommandSegment(segment);
    const words = parsed.words;
    candidates.push(...parsed.outputRedirects);
    const commandName = shellCommandName(words[0]);
    if (SHELL_MUTATION_COMMANDS_WITH_PATH_ARGS.has(commandName)) {
      const pathArguments = shellPositionalPathArguments(words);
      // cp 只写入最后一个目标参数；源路径只需要读取权限。
      candidates.push(...(commandName === 'cp' ? shellCopyDestinationArguments(words, pathArguments) : pathArguments));
      continue;
    }
    if (obviousHighRiskShellReason(segment)) {
      candidates.push(...shellLiteralPathCandidates(words));
    }
  }
  return [...new Set(candidates.map((item) => String(item || '').trim()).filter((item) => item && !isShellNonPathToken(item)))];
}

export function shellPathCandidates(command: unknown): string[] {
  const candidates = [...shellWritePathCandidates(command)];
  for (const segment of splitShellCommandSegments(command)) {
    const parsed = parseShellCommandSegment(segment);
    const words = parsed.words;
    candidates.push(...parsed.inputRedirects);
    const commandName = shellCommandName(words[0]);
    if (SHELL_READ_COMMANDS_WITH_PATH_ARGS.has(commandName) || SHELL_MUTATION_COMMANDS_WITH_PATH_ARGS.has(commandName)) {
      candidates.push(...shellPositionalPathArguments(words));
      continue;
    }
    if (obviousHighRiskShellReason(segment)) {
      candidates.push(...shellLiteralPathCandidates(words));
    }
  }
  return [...new Set(candidates.map((item) => String(item || '').trim()).filter((item) => item && !isShellNonPathToken(item)))];
}

// 路径策略只需要识别简单命令边界；保留引号和转义，交给下面的词法扫描处理。
function splitShellCommandSegments(command: unknown): string[] {
  const segments: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const char of String(command || '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (char === '&' && /[<>]\s*$/u.test(current)) {
      current += char;
      continue;
    }
    if (char === ';' || char === '&' || char === '|' || char === '\n') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

// 避免用空白正则拆 shell：带空格路径、复合命令和 2>/dev/null 都会产生错误路径。
function parseShellCommandSegment(command: unknown): ParsedShellCommandSegment {
  const words: string[] = [];
  const inputRedirects: string[] = [];
  const outputRedirects: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  let skippingRedirectTarget = false;
  let redirectTargetStarted = false;
  let redirectQuote = '';
  let redirectEscaped = false;
  let redirectTarget = '';
  let redirectType = '';

  const pushCurrent = () => {
    if (current) words.push(current);
    current = '';
  };
  const pushRedirect = () => {
    if (redirectTarget) {
      (redirectType === 'input' ? inputRedirects : outputRedirects).push(redirectTarget);
    }
    redirectTarget = '';
    redirectTargetStarted = false;
    redirectType = '';
  };

  const text = String(command || '');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (skippingRedirectTarget) {
      if (redirectEscaped) {
        redirectTarget += char;
        redirectEscaped = false;
        redirectTargetStarted = true;
        continue;
      }
      if (char === '\\') {
        if (backslashEscapesNext(redirectTarget, text[index + 1], redirectQuote)) redirectEscaped = true;
        else redirectTarget += char;
        redirectTargetStarted = true;
        continue;
      }
      if (redirectQuote) {
        if (char === redirectQuote) redirectQuote = '';
        else redirectTarget += char;
        redirectTargetStarted = true;
        continue;
      }
      if (char === '"' || char === "'") {
        redirectQuote = char;
        redirectTargetStarted = true;
        continue;
      }
      if (/\s/u.test(char)) {
        if (redirectTargetStarted) {
          pushRedirect();
          skippingRedirectTarget = false;
        }
        continue;
      }
      redirectTarget += char;
      redirectTargetStarted = true;
      continue;
    }
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      if (backslashEscapesNext(current, text[index + 1], quote)) escaped = true;
      else current += char;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      pushCurrent();
      continue;
    }
    if (char === '>' || char === '<') {
      if (current && !/^\d+$/u.test(current)) words.push(current);
      current = '';
      while (text[index + 1] === '>' || text[index + 1] === '<') index += 1;
      if (text[index + 1] === '&') index += 1;
      redirectType = char === '<' ? 'input' : 'output';
      skippingRedirectTarget = true;
      continue;
    }
    current += char;
  }
  if (skippingRedirectTarget) pushRedirect();
  else pushCurrent();
  return { words, inputRedirects, outputRedirects };
}

function shellPositionalPathArguments(words: readonly string[]): string[] {
  const candidates: string[] = [];
  let seenDoubleDash = false;
  for (const word of words.slice(1)) {
    if (!seenDoubleDash && word === '--') {
      seenDoubleDash = true;
      continue;
    }
    if (!seenDoubleDash && word.startsWith('-')) continue;
    candidates.push(word);
  }
  return candidates;
}

function shellCommandName(value: unknown): string {
  const basename = path.posix.basename(String(value || '').replaceAll('\\', '/')).toLowerCase();
  return basename.endsWith('.exe') ? basename.slice(0, -4) : basename;
}

function backslashEscapesNext(current: string, value: string | undefined, quote: string): boolean {
  if (!value) return false;
  if (quote === "'") return false;
  if (quote === '"') return /["\\$`\n]/u.test(value);
  if (/^[A-Za-z]:/u.test(current) || current.startsWith('\\')) return false;
  if (!current && value === '\\') return false;
  if (/^(?:%[^%]+%|\$\{?env:[^}]+\}?)/iu.test(current)) return false;
  return true;
}

function shellCopyDestinationArguments(
  words: readonly string[],
  positionalArguments = shellPositionalPathArguments(words),
): string[] {
  for (let index = 1; index < words.length; index += 1) {
    const word = String(words[index] || '');
    if (word === '--') break;
    if (word === '-t' || word === '--target-directory') {
      const targetDirectory = words[index + 1];
      return targetDirectory ? [targetDirectory] : [];
    }
    if (word.startsWith('--target-directory=')) {
      const targetDirectory = word.slice('--target-directory='.length);
      return targetDirectory ? [targetDirectory] : [];
    }
    if (word.startsWith('-t') && word.length > 2) return [word.slice(2)];
  }
  return positionalArguments.slice(-1);
}

function shellLiteralPathCandidates(words: readonly string[]): string[] {
  const candidates: string[] = [];
  const pathPrefix = /^(?:[A-Za-z]:[\\/]|\/|~\/|\.\.?[\\/])/u;
  const quotedPath = /(["'])((?:[A-Za-z]:[\\/]|\/|~\/|\.\.?[\\/]).*?)\1/gu;
  const embeddedPath = /(?:^|[\s"'=(])((?:[A-Za-z]:[\\/]|\/|~\/|\.\.?[\\/])[^\s"'`$<>|;&),\]]+)/gu;
  for (const rawWord of words) {
    const word = String(rawWord || '');
    if (pathPrefix.test(word)) {
      candidates.push(word);
      continue;
    }
    let unquoted = word;
    for (const match of word.matchAll(quotedPath)) {
      candidates.push(match[2]);
      unquoted = unquoted.replace(match[0], '');
    }
    for (const match of unquoted.matchAll(embeddedPath)) candidates.push(match[1]);
  }
  return candidates;
}

function isShellNonPathToken(value: string): boolean {
  if (!value || value === '.' || value === '..') return true;
  if (/^\/dev\/(?:null|stdout|stderr)$/u.test(value) || /^nul:?$/iu.test(value)) return true;
  if (/^\d+$/.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  return false;
}

export function shellCandidateToPath(raw: unknown): string {
  const value = String(raw || '').trim();
  if (value.startsWith('~/')) return path.join(process.env.HOME || '', value.slice(2));
  return value;
}
