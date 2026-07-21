// @ts-nocheck

/** Shell risk classification, policy evaluation, and OS sandbox profiles. */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { protectedWorkspaceMetadataPathForPath } from '../../security/file-system-policy.js';
import { assessShellNetworkAccess } from '../../security/network-approval-policy.js';
import {
  SHELL_MUTATION_COMMANDS_WITH_PATH_ARGS,
  SHELL_READ_COMMANDS_WITH_PATH_ARGS,
  EXEC_POLICY_CONFIG_NAMES,
  USER_EXEC_POLICY_CONFIG_PATHS,
} from './pc-local-tool-constants.js';
import {
  escapeRegExp,
} from './pc-local-tool-utils.js';
import {
  deniedRootsForState,
  deniedSandboxRuleForPath,
  realPathIfExists,
  normalizePermissionProfile,
  isPathInsideRoot,
  resolvePolicyPath,
} from './pc-local-tool-paths.js';

export function shellSandboxCapability(platform = process.platform, hasMacSandboxExec = existsSync('/usr/bin/sandbox-exec')) {
  if (platform === 'darwin') {
    if (hasMacSandboxExec) {
      return {
        supported: true,
        provider: 'macos-seatbelt',
        reason: '',
      };
    }
    return {
      supported: false,
      provider: '',
      reason: '系统缺少 /usr/bin/sandbox-exec，无法启用 OS sandbox。',
    };
  }
  if (platform === 'win32') {
    return {
      supported: false,
      provider: '',
      reason: 'Windows 当前没有可用的桌面 OS sandbox provider。受限权限下已拒绝 shell 执行；如确有需要，请显式批准一次无沙箱重试或切换到 danger-full-access。',
    };
  }
  return {
    supported: false,
    provider: '',
    reason: '当前平台没有可用的 OS sandbox provider。受限权限下已拒绝 shell 执行；如确有需要，请显式批准一次无沙箱重试或切换到 danger-full-access。',
  };
}

export function normalizeShellCommandForRisk(command) {
  return String(command || '')
    .replace(/\\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function obviousHighRiskShellReason(command) {
  const text = command.toLowerCase();
  const words = text.split(/[^a-z0-9_.-]+/).filter(Boolean);
  const hasWord = (value) => words.includes(value);

  if (_usesShellApplyPatch(text)) return '命令会通过 apply_patch 修改工作区文件。';
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

export function shellPolicyBlockReason(command, state) {
  const decision = shellPolicyDecision(command, state);
  if (decision.action !== 'deny') return '';
  return decision.reason || '命令被本地 exec policy 拒绝。';
}

export function shellPolicyDecision(command, state) {
  const normalized = normalizeShellCommandForRisk(command);
  const words = parseShellWords(normalized);
  const rules = Array.isArray(state?.shellPolicyRules) ? state.shellPolicyRules : [];
  for (const rule of rules) {
    if (!shellPolicyRuleMatches(rule, normalized, words)) continue;
    const action = rule.action || 'ask';
    return {
      action,
      reason: rule.reason || (
        action === 'allow'
          ? `命令匹配 allow policy：${rule.label}`
          : action === 'deny'
            ? `命令匹配 deny policy：${rule.label}`
            : `命令匹配 ask policy：${rule.label}`
      ),
      rule,
    };
  }
  return { action: '', reason: '', rule: null };
}

export function loadShellPolicyRules(workspaceRoot) {
  const paths = [
    ...USER_EXEC_POLICY_CONFIG_PATHS,
    ...EXEC_POLICY_CONFIG_NAMES.map((name) => path.join(workspaceRoot, name)),
  ];
  const rules = [];
  for (const configPath of paths) {
    const parsed = readJsonFileSync(configPath);
    if (!parsed || parsed.enabled === false) continue;
    rules.push(...normalizeShellPolicyRules(parsed, configPath));
  }
  return rules;
}

function readJsonFileSync(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeShellPolicyRules(config, sourcePath) {
  const shellConfig = config?.shell && typeof config.shell === 'object' && !Array.isArray(config.shell)
    ? config.shell
    : config;
  const rules = [];
  const rawRules = Array.isArray(shellConfig.rules) ? shellConfig.rules : [];
  for (const rawRule of rawRules) {
    const normalized = normalizeShellPolicyRule(rawRule, sourcePath);
    if (normalized) rules.push(normalized);
  }
  for (const action of ['deny', 'ask', 'allow']) {
    const entries = Array.isArray(shellConfig[action]) ? shellConfig[action] : [];
    for (const entry of entries) {
      const rawRule = typeof entry === 'string' || Array.isArray(entry)
        ? { action, prefix: entry }
        : { ...(entry || {}), action };
      const normalized = normalizeShellPolicyRule(rawRule, sourcePath);
      if (normalized) rules.push(normalized);
    }
  }
  return rules;
}

function normalizeShellPolicyRule(rawRule, sourcePath) {
  if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) return null;
  const action = normalizeShellPolicyAction(rawRule.action || rawRule.effect || rawRule.decision);
  if (!action) return null;
  const prefixWords = normalizeShellPolicyPrefix(rawRule.prefix ?? rawRule.prefix_rule);
  const command = normalizeShellCommandForRisk(rawRule.command || rawRule.exact || '');
  const pattern = String(rawRule.pattern || rawRule.match || '').trim();
  if (!prefixWords.length && !command && !pattern) return null;
  const label = command || (prefixWords.length ? prefixWords.join(' ') : pattern);
  return {
    action,
    command,
    pattern,
    prefixWords,
    label,
    sourcePath,
    reason: String(rawRule.reason || '').trim(),
  };
}

function normalizeShellPolicyAction(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'allow' || text === 'allowed') return 'allow';
  if (text === 'deny' || text === 'block' || text === 'forbid' || text === 'forbidden') return 'deny';
  if (text === 'ask' || text === 'confirm' || text === 'prompt') return 'ask';
  return '';
}

function normalizeShellPolicyPrefix(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value || '').trim();
  return text ? parseShellWords(text) : [];
}

function shellPolicyRuleMatches(rule, command, words) {
  if (rule.command && command === rule.command) return true;
  if (rule.prefixWords?.length) {
    if (words.length < rule.prefixWords.length) return false;
    return rule.prefixWords.every((word, index) => words[index] === word);
  }
  if (!rule.pattern) return false;
  const source = rule.pattern.split('*').map(escapeRegExp).join('.*');
  return new RegExp(`^${source}$`).test(command);
}

function parseShellWords(command) {
  const words = [];
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
      escaped = true;
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
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    if (';&|<>'.includes(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      break;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}

export function _usesShellApplyPatch(text) {
  return /(?:^|[;&|]\s*)(?:apply_patch|applypatch)\b/.test(text)
    || /\b(?:apply_patch|applypatch)\s*<</.test(text)
    || /<<[A-Z0-9_'-]*\s*\n?[^|&;]*(?:apply_patch|applypatch)\b/.test(text);
}

export function shellPermissionBlockReason(command, state) {
  const profile = normalizePermissionProfile(state?.permissionProfile);
  if (profile === 'danger-full-access') return '';
  const normalized = normalizeShellCommandForRisk(command);
  const highRiskReason = obviousHighRiskShellReason(normalized);
  const mutatesViaShell = Boolean(highRiskReason);
  const deniedAccessPath = firstDeniedShellAccessPath(normalized, state);
  if (deniedAccessPath) {
    return `当前权限配置不能通过 shell 访问 sandbox filesystem deny 规则覆盖的路径：${deniedAccessPath}。`;
  }
  if (profile === 'read-only' && mutatesViaShell) {
    const protectedPath = firstProtectedWorkspaceMetadataShellPath(normalized, state);
    if (protectedPath) {
      return `当前权限配置不能通过 shell 修改受保护的工作区元数据：${protectedPath}。需要 danger-full-access 权限才能执行。`;
    }
    const deniedPath = firstDeniedShellWritePath(normalized, state);
    if (deniedPath) {
      return `当前权限配置不能通过 shell 修改 sandbox filesystem deny 规则覆盖的路径：${deniedPath}。`;
    }
    if (state?.sandboxWorkspaceWrite?.networkAccess !== true && assessShellNetworkAccess(normalized)) {
      return '';
    }
    if (state?.sandboxWorkspaceWrite?.writableRoots?.length) {
      const outsidePath = firstPathOutsideWorkspaceWriteRoots(normalized, state, { includeWorkspaceRoot: false });
      if (!outsidePath && shellWritePathCandidates(normalized).length) return '';
      if (outsidePath) {
        return `当前权限配置为 read-only，仅允许修改已批准的 writable_roots，命令包含未授权路径：${outsidePath}。`;
      }
    }
    return `当前权限配置为 read-only，不能执行会修改本地环境的命令：${highRiskReason}`;
  }
  if (profile !== 'workspace-write' || !mutatesViaShell) return '';
  const protectedPath = firstProtectedWorkspaceMetadataShellPath(normalized, state);
  if (protectedPath) {
    return `当前权限配置不能通过 shell 修改受保护的工作区元数据：${protectedPath}。需要 danger-full-access 权限才能执行。`;
  }
  const deniedPath = firstDeniedShellWritePath(normalized, state);
  if (deniedPath) {
    return `当前权限配置不能通过 shell 修改 sandbox filesystem deny 规则覆盖的路径：${deniedPath}。`;
  }
  const outsidePath = firstPathOutsideWorkspaceWriteRoots(normalized, state);
  if (!outsidePath) return '';
  return `当前权限配置只允许修改工作区或 sandbox_workspace_write.writable_roots，命令包含未授权路径：${outsidePath}。需要 danger-full-access 权限才能执行。`;
}

export function shellNetworkBlockReason(command, state) {
  const profile = normalizePermissionProfile(state?.permissionProfile);
  if (profile === 'danger-full-access') return null;
  if (state?.sandboxWorkspaceWrite?.networkAccess === true) return null;
  const assessment = assessShellNetworkAccess(normalizeShellCommandForRisk(command));
  if (!assessment) return null;
  const policy = networkPolicyDecision(assessment.context, state);
  if (policy === 'allow') return null;
  return {
    message: policy === 'deny'
      ? `命令访问的网络目标被持久 network policy 拒绝：${assessment.context?.target ?? assessment.reason}`
      : `当前 sandbox_workspace_write.network_access 未开启，不能执行可能访问网络的命令：${assessment.reason}`,
    context: assessment.context,
    policyDecision: policy,
  };
}

function networkPolicyDecision(context, state) {
  if (!context?.host) return '';
  const amendments = Array.isArray(state?.networkPolicyAmendments) ? state.networkPolicyAmendments : [];
  const host = String(context.host || '').trim().toLowerCase();
  const match = [...amendments].reverse().find((item) => String(item?.host || '').trim().toLowerCase() === host);
  if (!match) return '';
  if (match.action === 'allow') return 'allow';
  if (match.action === 'deny') return 'deny';
  return '';
}

export function shellSandboxUnavailableReason(state, capability = shellSandboxCapability()) {
  if (!state?.osSandbox) return '';
  const profile = normalizePermissionProfile(state?.permissionProfile);
  if (profile === 'danger-full-access') return '';
  if (profile !== 'read-only' && profile !== 'workspace-write') {
    return 'OS sandbox 当前只支持 read-only 或 workspace-write 硬隔离；请关闭 os_sandbox，或切换权限配置。';
  }
  if (!capability.supported) return capability.reason;
  if (capability.provider !== 'macos-seatbelt') return '当前 OS sandbox provider 不支持 shell 硬隔离。';
  return '';
}

function firstPathOutsideWorkspaceWriteRoots(command, state, options = {}) {
  const workspaceRoot = resolvePolicyPath(state?.root || process.cwd());
  const allowedRoots = shellWorkspaceWriteRoots(state, options);
  for (const raw of shellWritePathCandidates(command)) {
    const candidate = shellCandidateToPath(raw);
    const resolved = resolvePolicyPath(candidate, workspaceRoot);
    if (allowedRoots.some((root) => isPathInsideRoot(resolved, root))) continue;
    return raw;
  }
  return '';
}

function firstDeniedShellWritePath(command, state) {
  const workspaceRoot = resolvePolicyPath(state?.root || process.cwd());
  for (const raw of shellWritePathCandidates(command)) {
    const candidate = shellCandidateToPath(raw);
    const resolved = resolvePolicyPath(candidate, workspaceRoot);
    if (deniedSandboxRuleForPath(resolved, state)) return raw;
  }
  return '';
}

function firstDeniedShellAccessPath(command, state) {
  const workspaceRoot = resolvePolicyPath(state?.root || process.cwd());
  for (const raw of shellPathCandidates(command)) {
    const candidate = shellCandidateToPath(raw);
    const resolved = resolvePolicyPath(candidate, workspaceRoot);
    if (deniedSandboxRuleForPath(resolved, state)) return raw;
  }
  return '';
}

function shellWritePathCandidates(command) {
  const candidates = [];
  const text = String(command || '');

  for (const segment of splitShellCommandSegments(text)) {
    const parsed = parseShellCommandSegment(segment);
    const words = parsed.words;
    candidates.push(...parsed.outputRedirects);
    const commandName = path.basename(words[0] || '');
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

function shellPathCandidates(command) {
  const candidates = [...shellWritePathCandidates(command)];
  for (const segment of splitShellCommandSegments(command)) {
    const parsed = parseShellCommandSegment(segment);
    const words = parsed.words;
    candidates.push(...parsed.inputRedirects);
    const commandName = path.basename(words[0] || '');
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
function splitShellCommandSegments(command) {
  const segments = [];
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
function parseShellCommandSegment(command) {
  const words = [];
  const inputRedirects = [];
  const outputRedirects = [];
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
        redirectEscaped = true;
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
      escaped = true;
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

function shellPositionalPathArguments(words) {
  const candidates = [];
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

function shellCopyDestinationArguments(words, positionalArguments = shellPositionalPathArguments(words)) {
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

function shellLiteralPathCandidates(words) {
  const candidates = [];
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

function isShellNonPathToken(value) {
  if (!value || value === '.' || value === '..') return true;
  if (/^\/dev\/(?:null|stdout|stderr)$/u.test(value) || /^nul:?$/iu.test(value)) return true;
  if (/^\d+$/.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  return false;
}

function firstProtectedWorkspaceMetadataShellPath(command, state) {
  const workspaceRoot = resolvePolicyPath(state?.root || process.cwd());
  const metadataMatches = String(command || '').matchAll(/(?:^|[\s"'=])((?:\.git|\.agents|\.codex)(?:\/[^\s"'`$<>|;&]*)?)/g);
  for (const match of metadataMatches) {
    const raw = match[1];
    const protectedPath = protectedWorkspaceMetadataPathForPath(resolvePolicyPath(raw, workspaceRoot), state?.permissionProfile);
    if (protectedPath) return raw;
  }
  const matches = String(command || '').matchAll(/(?:^|[\s"'=])((?:\/|~\/|\.\.?\/)[^\s"'`$<>|;&]+)/g);
  for (const match of matches) {
    const raw = match[1];
    const candidate = raw.startsWith('~/')
      ? path.join(process.env.HOME || '', raw.slice(2))
        : raw.startsWith('/')
          ? raw
          : resolvePolicyPath(raw, workspaceRoot);
    const protectedPath = protectedWorkspaceMetadataPathForPath(candidate, state?.permissionProfile);
    if (protectedPath) return raw;
  }
  return '';
}

export function shellWorkspaceWriteRoots(state, options = {}) {
  const roots = options.includeWorkspaceRoot === false ? [] : [state?.root || process.cwd()];
  const configuredRoots = Array.isArray(state?.sandboxWorkspaceWrite?.writableRoots)
    ? state.sandboxWorkspaceWrite.writableRoots
    : [];
  for (const rawRoot of configuredRoots) {
    const text = String(rawRoot || '').trim();
    if (!text) continue;
    roots.push(resolvePolicyPath(text, state?.root || process.cwd()));
  }
  return [...new Set(roots.map((root) => resolvePolicyPath(root)))];
}

function shellCandidateToPath(raw) {
  const value = String(raw || '').trim();
  if (value.startsWith('~/')) return path.join(process.env.HOME || '', value.slice(2));
  return value;
}

export function shellSandboxProfile(state, capability = shellSandboxCapability()) {
  if (!state?.osSandbox) return '';
  const profile = normalizePermissionProfile(state?.permissionProfile);
  if (profile === 'danger-full-access') return '';
  if (capability.provider !== 'macos-seatbelt') return '';
  const lines = [
    '(version 1)',
    '(allow default)',
  ];
  if (state?.sandboxWorkspaceWrite?.networkAccess !== true) lines.push('(deny network*)');
  if (profile === 'read-only') {
    const writableRoots = [...new Set(shellWorkspaceWriteRoots(state, { includeWorkspaceRoot: false }).map(realPathIfExists))];
    lines.push(seatbeltDenyWritesOutsideRoots(writableRoots));
    for (const root of deniedRootsForState(state)) {
      lines.push(`(deny file-write* (subpath ${seatbeltString(root)}))`);
    }
    return lines.join('\n');
  }
  if (profile !== 'workspace-write') return '';

  const writableRoots = [...new Set(shellWorkspaceWriteRoots(state).map(realPathIfExists))];
  // Seatbelt 无法用后续允许规则重新开放宽泛拒绝项，因此仅当目标位于所有已批准
  // 可写根目录之外时才拒绝写入。
  lines.push(seatbeltDenyWritesOutsideRoots(writableRoots));
  for (const root of deniedRootsForState(state)) {
    lines.push(`(deny file-write* (subpath ${seatbeltString(root)}))`);
  }
  return lines.join('\n');
}

function seatbeltDenyWritesOutsideRoots(roots) {
  const filters = roots
    .filter(Boolean)
    .map((root) => `(require-not (subpath ${seatbeltString(root)}))`);
  // 常见 Shell 重定向即使在其他方面只读的命令中也会使用 /dev/null。
  // 保持该设备可写，同时不开放任何普通路径。
  filters.push(`(require-not (literal ${seatbeltString('/dev/null')}))`);
  if (filters.length === 1) return `(deny file-write* ${filters[0]})`;
  return `(deny file-write* (require-all ${filters.join(' ')}))`;
}

function seatbeltString(value) {
  return JSON.stringify(String(value || ''));
}
