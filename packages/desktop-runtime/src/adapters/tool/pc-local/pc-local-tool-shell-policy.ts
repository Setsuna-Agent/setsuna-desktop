/** Shell risk classification, policy evaluation, and OS sandbox profiles. */

import type {
  RuntimeNetworkPolicyAmendment,
  RuntimeSandboxWorkspaceWrite,
} from '@setsuna-desktop/contracts';
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import type { SandboxExecutionPlan } from '../../../ports/sandbox-execution-plan.js';
import {
  windowsNativeSandboxCapability,
  type WindowsNativeSandboxCapability,
} from '../../sandbox/windows-native/windows-native-sandbox.js';
import { protectedWorkspaceMetadataPathForPath } from '../../../security/file-system-policy.js';
import {
  assessShellNetworkAccess,
  type RuntimeNetworkApprovalContext,
} from '../../../security/network-approval-policy.js';
import { reusableShellCommandWords } from '../../../security/shell-command-analysis.js';
import { recordInput } from '../../../shared/unknown.js';
import {
  EXEC_POLICY_CONFIG_NAMES,
} from './pc-local-tool-constants.js';
import {
  _usesShellApplyPatch,
  normalizeShellCommandForRisk,
  obviousHighRiskShellReason,
  shellCandidateToPath,
  shellPathCandidates,
  shellWritePathCandidates,
} from './pc-local-tool-shell-command-analysis.js';
import {
  deniedGlobRegExpSourcesForState,
  deniedRootsForState,
  deniedSandboxRuleForPath,
  isPathInsideRoot,
  normalizePermissionProfile,
  realPathIfExists,
  resolvePolicyPath,
  sandboxReadableRootsForState,
} from './pc-local-tool-paths.js';
import {
  escapeRegExp,
} from './pc-local-tool-utils.js';

export type ShellSandboxCapability = {
  supported: boolean;
  provider: string;
  reason: string;
  executablePath?: string;
};

type SandboxCurlConfiguration = {
  caBundlePath: string;
  configPath?: string;
  directory: string;
  executablePath: string;
};

export type ShellPolicyAction = 'allow' | 'ask' | 'deny';

export type ShellPolicyRule = {
  action: ShellPolicyAction;
  command: string;
  pattern: string;
  prefixWords: string[];
  label: string;
  sourcePath: string;
  reason: string;
};

export type ShellPolicyState = {
  root?: string;
  permissionProfile?: unknown;
  sandboxWorkspaceWrite?: RuntimeSandboxWorkspaceWrite;
  /** Host-only grants are intentionally excluded from OS shell sandbox plans. */
  directToolReadableRoots?: readonly string[];
  osSandbox?: boolean;
  shellPolicyRules?: readonly unknown[];
  networkPolicyAmendments?: readonly RuntimeNetworkPolicyAmendment[] | readonly unknown[];
  shellEnvironment?: Record<string, string>;
};

export type ShellPolicyDecision = {
  action: ShellPolicyAction | '';
  reason: string;
  rule: ShellPolicyRule | null;
};

type ShellWorkspaceWriteRootOptions = {
  includeWorkspaceRoot?: boolean;
};

export {
  _usesShellApplyPatch,
  codexDangerousShellReason,
  normalizeShellCommandForRisk,
  obviousHighRiskShellReason,
} from './pc-local-tool-shell-command-analysis.js';

export function shellSandboxCapability(
  platform: NodeJS.Platform | string = process.platform,
  hasMacSandboxExec = existsSync('/usr/bin/sandbox-exec'),
  windowsCapability: WindowsNativeSandboxCapability = windowsNativeSandboxCapability(),
): ShellSandboxCapability {
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
    return windowsCapability;
  }
  return {
    supported: false,
    provider: '',
    reason: '当前平台没有可用的 OS sandbox provider。交互审批模式会在命令执行前请求一次无沙箱批准；禁止提示且保持受限权限的组合会拒绝执行。',
  };
}

export function shellPolicyBlockReason(command: unknown, state: ShellPolicyState): string {
  const decision = shellPolicyDecision(command, state);
  if (decision.action !== 'deny') return '';
  return decision.reason || '命令被本地 exec policy 拒绝。';
}

export function shellPolicyDecision(
  command: unknown,
  state: ShellPolicyState | null,
): ShellPolicyDecision {
  const rawCommand = String(command || '');
  // Reusable authorization must inspect the original shell program. Display
  // normalization intentionally collapses newlines, which would otherwise turn
  // a command separator into an apparent argument boundary.
  const reusableWords = reusableShellCommandWords(rawCommand);
  const rules = Array.isArray(state?.shellPolicyRules) ? state.shellPolicyRules : [];
  for (const input of rules) {
    const rule = normalizeShellPolicyRule(input, String(recordInput(input).sourcePath ?? ''));
    if (!rule) continue;
    if (!shellPolicyRuleMatches(rule, rawCommand, reusableWords)) continue;
    const action = rule.action;
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

export function loadShellPolicyRules(
  workspaceRoot: string,
  userConfigPaths: readonly string[] = [],
): ShellPolicyRule[] {
  const paths = [
    ...userConfigPaths,
    ...EXEC_POLICY_CONFIG_NAMES.map((name) => path.join(workspaceRoot, name)),
  ];
  const rules: ShellPolicyRule[] = [];
  for (const configPath of paths) {
    const parsed = readJsonFileSync(configPath);
    if (!parsed || recordInput(parsed).enabled === false) continue;
    rules.push(...normalizeShellPolicyRules(parsed, configPath));
  }
  return rules;
}

function readJsonFileSync(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeShellPolicyRules(config: unknown, sourcePath: string): ShellPolicyRule[] {
  const configRecord = recordInput(config);
  const shellValue = configRecord.shell;
  const shellConfig = shellValue && typeof shellValue === 'object' && !Array.isArray(shellValue)
    ? recordInput(shellValue)
    : configRecord;
  const rules: ShellPolicyRule[] = [];
  const rawRules = Array.isArray(shellConfig.rules) ? shellConfig.rules : [];
  for (const rawRule of rawRules) {
    const normalized = normalizeShellPolicyRule(rawRule, sourcePath);
    if (normalized) rules.push(normalized);
  }
  for (const action of ['deny', 'ask', 'allow'] as const) {
    const entries = Array.isArray(shellConfig[action]) ? shellConfig[action] : [];
    for (const entry of entries) {
      const rawRule = typeof entry === 'string' || Array.isArray(entry)
        ? { action, prefix: entry }
        : { ...recordInput(entry), action };
      const normalized = normalizeShellPolicyRule(rawRule, sourcePath);
      if (normalized) rules.push(normalized);
    }
  }
  return rules;
}

function normalizeShellPolicyRule(rawRule: unknown, sourcePath: string): ShellPolicyRule | null {
  if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) return null;
  const record = recordInput(rawRule);
  const action = normalizeShellPolicyAction(record.action || record.effect || record.decision);
  if (!action) return null;
  const prefixWords = normalizeShellPolicyPrefix(
    record.prefix ?? record.prefix_rule ?? record.prefixWords,
  );
  // Exact rules deliberately preserve internal whitespace and shell control
  // characters. Risk-display normalization must never change the program that
  // a persisted authorization represents.
  const command = String(record.command ?? record.exact ?? '').trim();
  const pattern = String(record.pattern || record.match || '').trim();
  if (!prefixWords.length && !command && !pattern) return null;
  const label = String(record.label || '').trim()
    || command
    || (prefixWords.length ? prefixWords.join(' ') : pattern);
  return {
    action,
    command,
    pattern,
    prefixWords,
    label,
    sourcePath,
    reason: String(record.reason || '').trim(),
  };
}

function normalizeShellPolicyAction(value: unknown): ShellPolicyAction | '' {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'allow' || text === 'allowed') return 'allow';
  if (text === 'deny' || text === 'block' || text === 'forbid' || text === 'forbidden') return 'deny';
  if (text === 'ask' || text === 'confirm' || text === 'prompt') return 'ask';
  return '';
}

function normalizeShellPolicyPrefix(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value || '').trim();
  return text ? reusableShellCommandWords(text) : [];
}

function shellPolicyRuleMatches(
  rule: ShellPolicyRule,
  rawCommand: string,
  reusableWords: readonly string[],
): boolean {
  if (rule.command && rawCommand === rule.command) return true;
  if (rule.prefixWords?.length) {
    if (!reusableWords.length || reusableWords.length < rule.prefixWords.length) return false;
    return rule.prefixWords.every((word, index) => reusableWords[index] === word);
  }
  if (!rule.pattern) return false;
  const source = rule.pattern.split('*').map(escapeRegExp).join('.*');
  return new RegExp(`^${source}$`).test(rawCommand);
}

export function shellPermissionBlockReason(command: unknown, state: ShellPolicyState): string {
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
    if (
      state?.sandboxWorkspaceWrite?.networkAccess !== true
      && assessShellNetworkAccess(String(command || ''))
    ) {
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

export function shellNetworkBlockReason(command: unknown, state: ShellPolicyState) {
  const profile = normalizePermissionProfile(state?.permissionProfile);
  if (profile === 'danger-full-access') return null;
  if (state?.sandboxWorkspaceWrite?.networkAccess === true) return null;
  // Network target extraction is structural and must retain raw separators.
  const assessment = assessShellNetworkAccess(String(command || ''));
  if (!assessment) return null;
  const deniedContext = assessment.contexts.find((context) => networkPolicyDecision(context, state) === 'deny');
  if (deniedContext) {
    return {
      message: `命令访问的网络目标被持久 network policy 拒绝：${deniedContext.target}`,
      context: deniedContext,
      contexts: assessment.contexts,
      policyDecision: 'deny',
    };
  }
  return {
    message: `当前 sandbox_workspace_write.network_access 未开启，不能执行可能访问网络的命令：${assessment.reason}`,
    context: assessment.context,
    contexts: assessment.contexts,
    policyDecision: '',
  };
}

function networkPolicyDecision(
  context: RuntimeNetworkApprovalContext,
  state: ShellPolicyState,
): 'allow' | 'deny' | '' {
  if (!context?.host) return '';
  const amendments = Array.isArray(state?.networkPolicyAmendments) ? state.networkPolicyAmendments : [];
  const host = String(context.host || '').trim().toLowerCase();
  const match = [...amendments].reverse().find((item) => {
    const record = recordInput(item);
    return String(record.host || '').trim().toLowerCase() === host;
  });
  if (!match) return '';
  const action = recordInput(match).action;
  if (action === 'allow') return 'allow';
  if (action === 'deny') return 'deny';
  return '';
}

export function shellSandboxUnavailableReason(
  state: ShellPolicyState,
  capability: ShellSandboxCapability = shellSandboxCapability(),
): string {
  if (!state?.osSandbox) return '';
  const profile = normalizePermissionProfile(state?.permissionProfile);
  if (profile === 'danger-full-access') return '';
  if (profile !== 'read-only' && profile !== 'workspace-write') {
    return 'OS sandbox 当前只支持 read-only 或 workspace-write 硬隔离；请关闭 os_sandbox，或切换权限配置。';
  }
  if (!capability.supported) return capability.reason;
  if (capability.provider !== 'macos-seatbelt' && capability.provider !== 'windows-native') {
    return '当前 OS sandbox provider 不支持 shell 硬隔离。';
  }
  if (
    capability.provider === 'windows-native'
    && (deniedRootsForState(state).length || deniedGlobRegExpSourcesForState(state).length)
  ) {
    return 'Windows 原生沙箱 V1 无法强制执行 denied_roots 或 denied_glob_patterns；已拒绝降级到较弱隔离。';
  }
  return '';
}

function firstPathOutsideWorkspaceWriteRoots(
  command: unknown,
  state: ShellPolicyState,
  options: ShellWorkspaceWriteRootOptions = {},
): string {
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

function firstDeniedShellWritePath(command: unknown, state: ShellPolicyState): string {
  const workspaceRoot = resolvePolicyPath(state?.root || process.cwd());
  for (const raw of shellWritePathCandidates(command)) {
    const candidate = shellCandidateToPath(raw);
    const resolved = resolvePolicyPath(candidate, workspaceRoot);
    if (deniedSandboxRuleForPath(resolved, state)) return raw;
  }
  return '';
}

function firstDeniedShellAccessPath(command: unknown, state: ShellPolicyState): string {
  const workspaceRoot = resolvePolicyPath(state?.root || process.cwd());
  for (const raw of shellPathCandidates(command)) {
    const candidate = shellCandidateToPath(raw);
    const resolved = resolvePolicyPath(candidate, workspaceRoot);
    if (deniedSandboxRuleForPath(resolved, state)) return raw;
  }
  return '';
}

function firstProtectedWorkspaceMetadataShellPath(
  command: unknown,
  state: ShellPolicyState,
): string {
  const permissionProfile = normalizePermissionProfile(state?.permissionProfile);
  const workspaceRoot = resolvePolicyPath(state?.root || process.cwd());
  for (const raw of shellWritePathCandidates(command)) {
    const candidate = resolvePolicyPath(shellCandidateToPath(raw), workspaceRoot);
    const protectedPath = protectedWorkspaceMetadataPathForPath(candidate, permissionProfile)
      || protectedWorkspaceMetadataPathForPath(realPathIfExists(candidate), permissionProfile);
    if (protectedPath) return raw;
  }
  const metadataMatches = String(command || '').matchAll(/(?:^|[\s"'=])((?:\.git|\.agents|\.codex)(?:\/[^\s"'`$<>|;&]*)?)/gi);
  for (const match of metadataMatches) {
    const raw = match[1];
    if (!raw) continue;
    const protectedPath = protectedWorkspaceMetadataPathForPath(
      resolvePolicyPath(raw, workspaceRoot),
      permissionProfile,
    );
    if (protectedPath) return raw;
  }
  const matches = String(command || '').matchAll(/(?:^|[\s"'=])((?:\/|~\/|\.\.?\/)[^\s"'`$<>|;&]+)/g);
  for (const match of matches) {
    const raw = match[1];
    if (!raw) continue;
    const candidate = raw.startsWith('~/')
      ? path.join(process.env.HOME || '', raw.slice(2))
        : raw.startsWith('/')
          ? raw
          : resolvePolicyPath(raw, workspaceRoot);
    const protectedPath = protectedWorkspaceMetadataPathForPath(candidate, permissionProfile)
      || protectedWorkspaceMetadataPathForPath(realPathIfExists(candidate), permissionProfile);
    if (protectedPath) return raw;
  }
  return '';
}

export function shellWorkspaceWriteRoots(
  state: ShellPolicyState,
  options: ShellWorkspaceWriteRootOptions = {},
): string[] {
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

export function createShellSandboxExecutionPlan(
  state: ShellPolicyState,
  options: {
    cwd?: string;
    environment?: Record<string, string>;
    capability?: ShellSandboxCapability;
    temporaryRoot?: string;
  } = {},
): SandboxExecutionPlan {
  const permissionProfile = normalizePermissionProfile(state?.permissionProfile);
  const capability = options.capability ?? shellSandboxCapability();
  const provider = !state?.osSandbox || permissionProfile === 'danger-full-access'
    ? 'bypass'
    : capability.supported && capability.provider === 'macos-seatbelt'
      ? 'macos-seatbelt'
      : capability.supported && capability.provider === 'windows-native'
        ? 'windows-native'
        : 'unavailable';
  const environment = { ...(options.environment ?? state?.shellEnvironment ?? {}) };
  const sandboxCurl = provider === 'windows-native' ? sandboxCurlConfiguration() : null;
  if (sandboxCurl) applySandboxCurlEnvironment(environment, sandboxCurl);
  // The process layer gives each sandboxed shell its own temporary directory.
  // Grant that one directory instead of widening to the shared user temp root.
  const defaultTempRoots = (
    provider === 'macos-seatbelt' || provider === 'windows-native'
  ) && permissionProfile === 'workspace-write'
    ? shellSandboxTempRoots(options.temporaryRoot)
    : [];
  const writableRoots = permissionProfile === 'read-only'
    ? shellWorkspaceWriteRoots(state, { includeWorkspaceRoot: false })
    : [...shellWorkspaceWriteRoots(state), ...defaultTempRoots];
  const workspaceRoot = realPathIfExists(state?.root || process.cwd());
  const resolvedWritableRoots = [...new Set(writableRoots.map(realPathIfExists))];
  return {
    cwd: path.resolve(options.cwd ?? workspaceRoot),
    workspaceRoot,
    permissionProfile,
    provider,
    ...(provider === 'windows-native' && capability.executablePath
      ? { providerExecutable: capability.executablePath }
      : {}),
    readableRoots: shellExplicitReadableRoots(state, [
      ...defaultTempRoots,
      ...sandboxCurlReadableRoots(sandboxCurl),
    ]),
    writableRoots: resolvedWritableRoots,
    ephemeralWritableRoots: provider === 'windows-native'
      ? [...new Set(defaultTempRoots.map(realPathIfExists))]
      : [],
    deniedRoots: deniedRootsForState(state),
    deniedGlobRegExpSources: deniedGlobRegExpSourcesForState(state),
    protectedWritableRoots: ['.git', '.agents', '.codex']
      .map((name) => realPathIfExists(path.join(workspaceRoot, name)))
      // NTFS ACLs cannot reserve an absent child name. Protect every metadata
      // directory that exists when the execution plan is materialized.
      .filter((protectedRoot) => (
        provider !== 'windows-native'
        || (
          existsSync(protectedRoot)
          && resolvedWritableRoots.some((writableRoot) => isPathInsideRoot(protectedRoot, writableRoot))
        )
      )),
    networkAccess: state?.sandboxWorkspaceWrite?.networkAccess === true,
    environment,
  };
}

export function shellSandboxProfile(
  stateOrPlan: ShellPolicyState | SandboxExecutionPlan,
  capability: ShellSandboxCapability = shellSandboxCapability(),
): string {
  const plan = isSandboxExecutionPlan(stateOrPlan)
    ? stateOrPlan
    : createShellSandboxExecutionPlan(stateOrPlan, { capability });
  if (plan.provider !== 'macos-seatbelt') return '';
  const profile = plan.permissionProfile;
  const lines = [
    '(version 1)',
    '(allow default)',
  ];
  const readableRoots = [...plan.readableRoots, ...MACOS_SEATBELT_SYSTEM_READ_ROOTS];
  lines.push(seatbeltDenyOutsideRoots('file-read*', readableRoots, MACOS_SEATBELT_EXACT_READ_PATHS));
  if (!plan.networkAccess) lines.push('(deny network*)');
  if (profile === 'read-only') {
    lines.push(seatbeltDenyWritesOutsideRoots(plan.writableRoots));
    for (const root of plan.deniedRoots) {
      lines.push(`(deny file-read* (literal ${seatbeltString(root)}))`);
      lines.push(`(deny file-read* (subpath ${seatbeltString(root)}))`);
      lines.push(`(deny file-write* (literal ${seatbeltString(root)}))`);
      lines.push(`(deny file-write* (subpath ${seatbeltString(root)}))`);
    }
    lines.push(...seatbeltDeniedGlobRules(plan));
    lines.push(...seatbeltProtectedMetadataRules(plan));
    return lines.join('\n');
  }
  if (profile !== 'workspace-write') return '';

  // Seatbelt 无法用后续允许规则重新开放宽泛拒绝项，因此仅当目标位于所有已批准
  // 可写根目录之外时才拒绝写入。
  lines.push(seatbeltDenyWritesOutsideRoots(plan.writableRoots));
  for (const root of plan.deniedRoots) {
    lines.push(`(deny file-read* (literal ${seatbeltString(root)}))`);
    lines.push(`(deny file-read* (subpath ${seatbeltString(root)}))`);
    lines.push(`(deny file-write* (literal ${seatbeltString(root)}))`);
    lines.push(`(deny file-write* (subpath ${seatbeltString(root)}))`);
  }
  lines.push(...seatbeltDeniedGlobRules(plan));
  lines.push(...seatbeltProtectedMetadataRules(plan));
  return lines.join('\n');
}

function isSandboxExecutionPlan(value: unknown): value is SandboxExecutionPlan {
  const record = recordInput(value);
  return typeof record.provider === 'string' && Array.isArray(record.readableRoots);
}

const MACOS_SEATBELT_SYSTEM_READ_ROOTS: readonly string[] = [
  '/System',
  '/usr',
  '/bin',
  '/sbin',
  '/dev',
  '/Library/Apple',
  // Keep OS bootstrap/network data narrowly scoped; granting all of /private/etc
  // would reintroduce an unrestricted local-config read channel.
  '/private/etc/ssl',
  '/private/etc/hosts',
  '/private/etc/resolv.conf',
  '/private/etc/services',
  '/private/etc/protocols',
  '/private/var/select/sh',
  '/private/var/select/developer_dir',
  '/var/select/developer_dir',
  '/private/var/db/timezone',
];

const MACOS_SEATBELT_EXACT_READ_PATHS: readonly string[] = [
  '/private/etc/hosts',
  '/private/etc/resolv.conf',
  '/private/etc/services',
  '/private/etc/protocols',
  '/private/var/select/sh',
  '/private/var/select/developer_dir',
  '/var/select/developer_dir',
];

function shellSandboxTempRoots(temporaryRoot: unknown): string[] {
  const candidate = String(temporaryRoot ?? '').trim();
  if (!candidate || !path.isAbsolute(candidate)) return [];
  try {
    return statSync(candidate).isDirectory() ? [path.resolve(candidate)] : [];
  } catch {
    return [];
  }
}

function shellExplicitReadableRoots(
  state: ShellPolicyState,
  additionalRoots: readonly string[] = [],
): string[] {
  const roots = [
    ...sandboxReadableRootsForState(state),
    ...shellWorkspaceWriteRoots(state),
    ...additionalRoots,
  ];
  return [...new Set(roots
    .flatMap(shellReadablePathVariants)
    .filter((root) => Boolean(root) && path.resolve(root) !== path.parse(path.resolve(root)).root))];
}

function sandboxCurlConfiguration(): SandboxCurlConfiguration | null {
  const executablePath = existingAbsoluteFile(
    process.env.SETSUNA_DESKTOP_SANDBOX_CURL_PATH,
  );
  const caBundlePath = existingAbsoluteFile(
    process.env.SETSUNA_DESKTOP_SANDBOX_CA_BUNDLE,
  );
  if (!executablePath || !caBundlePath) return null;
  const pathApi = usesWindowsPathSemantics(executablePath) ? path.win32 : path;
  const directory = pathApi.dirname(executablePath);
  const configPath = existingAbsoluteFile(pathApi.join(directory, '_curlrc'));
  return {
    caBundlePath,
    ...(configPath ? { configPath } : {}),
    directory,
    executablePath,
  };
}

function existingAbsoluteFile(value: unknown): string {
  const candidate = String(value ?? '').trim();
  if (!candidate || (!path.isAbsolute(candidate) && !path.win32.isAbsolute(candidate))) return '';
  try {
    return statSync(candidate).isFile() ? candidate : '';
  } catch {
    return '';
  }
}

function sandboxCurlReadableRoots(configuration: SandboxCurlConfiguration | null): string[] {
  if (!configuration) return [];
  return [
    configuration.executablePath,
    configuration.caBundlePath,
    configuration.configPath ?? '',
  ].filter(Boolean);
}

function applySandboxCurlEnvironment(
  environment: Record<string, string>,
  configuration: SandboxCurlConfiguration,
): void {
  const windowsPath = usesWindowsPathSemantics(configuration.executablePath);
  const delimiter = windowsPath ? ';' : path.delimiter;
  const existingPath = environmentValue(environment, 'PATH');
  const comparison = (value: string) => windowsPath ? value.toLowerCase() : value;
  const directoryKey = comparison(configuration.directory);
  const pathEntries = existingPath
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry && comparison(entry) !== directoryKey);
  setEnvironmentValue(environment, 'PATH', [configuration.directory, ...pathEntries].join(delimiter));
  setEnvironmentValue(environment, 'CURL_HOME', configuration.directory);
  setEnvironmentValue(environment, 'CURL_CA_BUNDLE', configuration.caBundlePath);
}

function usesWindowsPathSemantics(value: string): boolean {
  if (process.platform === 'win32') return true;
  // win32.isAbsolute also treats POSIX root paths such as `/tmp` as absolute.
  // Outside Windows, only drive-qualified and UNC paths should select `;` and
  // win32 dirname behavior.
  return /^[a-z]:[\\/]/iu.test(value) || /^\\\\/u.test(value);
}

function environmentValue(environment: Record<string, string>, name: string): string {
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? environment[key] ?? '' : '';
}

function setEnvironmentValue(
  environment: Record<string, string>,
  name: string,
  value: string,
): void {
  for (const key of Object.keys(environment)) {
    if (key !== name && key.toLowerCase() === name.toLowerCase()) delete environment[key];
  }
  environment[name] = value;
}

function shellReadablePathVariants(value: unknown): string[] {
  const lexical = path.resolve(String(value || ''));
  const canonical = realPathIfExists(lexical);
  const variants = new Set([lexical, canonical]);
  collectShellSymlinkPathVariants(lexical, variants, new Set(), 0);
  return [...variants];
}

function collectShellSymlinkPathVariants(
  value: unknown,
  variants: Set<string>,
  visited: Set<string>,
  depth: number,
): void {
  if (depth >= 16) return;
  const resolved = path.resolve(String(value || ''));
  if (visited.has(resolved)) return;
  visited.add(resolved);
  const parsed = path.parse(resolved);
  const parts = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let symbolicLink = false;
    try {
      symbolicLink = lstatSync(current).isSymbolicLink();
    } catch {
      return;
    }
    if (!symbolicLink) continue;
    const rawTarget = readlinkSync(current);
    const target = path.resolve(path.dirname(current), rawTarget);
    variants.add(current);
    variants.add(target);
    collectShellSymlinkPathVariants(target, variants, visited, depth + 1);
    const remaining = parts.slice(index + 1);
    if (remaining.length) {
      const targetWithRemainder = path.join(realPathIfExists(target), ...remaining);
      variants.add(targetWithRemainder);
      collectShellSymlinkPathVariants(targetWithRemainder, variants, visited, depth + 1);
    }
  }
}

function seatbeltDeniedGlobRules(plan: SandboxExecutionPlan) {
  return plan.deniedGlobRegExpSources.flatMap((source) => [
    // Seatbelt's #"..." regex form is raw. Feeding it JSON-escaped text would
    // turn `\.` into two backslashes and silently stop matching paths such as
    // `.env`. A normal Scheme string decodes the JSON escape exactly once.
    `(deny file-read* (regex ${seatbeltString(source)}))`,
    `(deny file-write* (regex ${seatbeltString(source)}))`,
  ]);
}

function seatbeltProtectedMetadataRules(plan: SandboxExecutionPlan) {
  if (plan.permissionProfile === 'danger-full-access') return [];
  return plan.protectedWritableRoots.flatMap((protectedRoot) => {
    return [
      `(deny file-write* (literal ${seatbeltString(protectedRoot)}))`,
      `(deny file-write* (subpath ${seatbeltString(protectedRoot)}))`,
    ];
  });
}

function seatbeltDenyOutsideRoots(
  operation: string,
  roots: readonly string[],
  exactPaths: readonly string[] = [],
): string {
  const normalizedRoots = roots.filter(Boolean).map((root) => path.resolve(root));
  const normalizedExactPaths = exactPaths.filter(Boolean).map((filePath) => path.resolve(filePath));
  const filters = normalizedRoots.map((root) => `(require-not (subpath ${seatbeltString(root)}))`);
  // Seatbelt's subpath filter excludes the directory itself. Shell startup and
  // getcwd need metadata reads on each parent, so allow only those exact
  // directory nodes without exposing sibling contents.
  for (const traversalPath of seatbeltTraversalPaths([...normalizedRoots, ...normalizedExactPaths])) {
    filters.push(`(require-not (literal ${seatbeltString(traversalPath)}))`);
  }
  if (!filters.length) return `(deny ${operation})`;
  if (filters.length === 1) return `(deny ${operation} ${filters[0]})`;
  return `(deny ${operation} (require-all ${filters.join(' ')}))`;
}

function seatbeltTraversalPaths(roots: readonly string[]): string[] {
  const paths = new Set(['/']);
  for (const root of roots) {
    let current = root;
    while (current) {
      paths.add(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return [...paths];
}

function seatbeltDenyWritesOutsideRoots(roots: readonly string[]): string {
  const filters = roots
    .filter(Boolean)
    .map((root) => `(require-not (subpath ${seatbeltString(root)}))`);
  // 常见 Shell 重定向即使在其他方面只读的命令中也会使用 /dev/null。
  // 保持该设备可写，同时不开放任何普通路径。
  filters.push(`(require-not (literal ${seatbeltString('/dev/null')}))`);
  if (filters.length === 1) return `(deny file-write* ${filters[0]})`;
  return `(deny file-write* (require-all ${filters.join(' ')}))`;
}

function seatbeltString(value: unknown): string {
  return JSON.stringify(String(value || ''));
}
