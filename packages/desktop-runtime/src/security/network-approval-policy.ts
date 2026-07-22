import { analyzeShellCommandStructure } from './shell-command-analysis.js';

export type RuntimeNetworkApprovalProtocol = 'http' | 'https' | 'socks5-tcp' | 'socks5-udp' | 'tcp' | 'unknown';

export type RuntimeNetworkApprovalContext = {
  host: string;
  protocol: RuntimeNetworkApprovalProtocol;
  port: number;
  target: string;
};

export type ShellNetworkAssessment = {
  reason: string;
  /** Informational target extracted from a simple command; not an enforcement boundary. */
  context?: RuntimeNetworkApprovalContext;
  contexts: RuntimeNetworkApprovalContext[];
  /** True means a host-scoped approval would understate the process capability. */
  requiresCommandWideApproval: boolean;
};

const DIRECT_NETWORK_COMMANDS = new Set(['curl', 'wget', 'ssh', 'scp', 'sftp', 'ftp', 'rsync', 'telnet', 'nc', 'ncat']);
const JS_PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PYTHON_PACKAGE_MANAGERS = new Set(['pip', 'pip3', 'uv']);
const DEPLOY_CLIS = new Set(['vercel', 'netlify', 'firebase', 'wrangler']);

export function assessShellNetworkAccess(command: string): ShellNetworkAssessment | null {
  const structure = analyzeShellCommandStructure(command.toLowerCase());
  const contexts: RuntimeNetworkApprovalContext[] = [];
  let detected = false;
  let hasUnknownTarget = false;
  for (const segment of structure.segments) {
    const words = parseShellWords(segment);
    const { executable, args } = shellExecutableInfo(words);
    if (!executable) continue;
    const segmentContexts = networkContextsFromWords(executable, args);
    let segmentDetected = false;
    if (DIRECT_NETWORK_COMMANDS.has(executable)) {
      segmentDetected = true;
    }
    if (executable === 'git' && ['clone', 'fetch', 'pull', 'push', 'ls-remote'].includes(args[0] ?? '')) {
      segmentDetected = true;
    }
    if (executable === 'git' && args[0] === 'submodule' && args[1] === 'update') {
      segmentDetected = true;
    }
    if (JS_PACKAGE_MANAGERS.has(executable) && ['install', 'i', 'add', 'update', 'upgrade', 'publish', 'release'].includes(args[0] ?? '')) {
      segmentDetected = true;
    }
    if (PYTHON_PACKAGE_MANAGERS.has(executable) && ['install', 'sync', 'add', 'publish'].includes(args[0] ?? '')) {
      segmentDetected = true;
    }
    if (executable === 'cargo' && ['install', 'update', 'publish'].includes(args[0] ?? '')) {
      segmentDetected = true;
    }
    if (executable === 'go' && (args[0] === 'get' || args[0] === 'install' || (args[0] === 'mod' && args[1] === 'download'))) {
      segmentDetected = true;
    }
    if (DEPLOY_CLIS.has(executable) && ['deploy', 'publish', 'login'].includes(args[0] ?? '')) {
      segmentDetected = true;
    }
    if (!segmentDetected) continue;
    detected = true;
    if (!segmentContexts.length) hasUnknownTarget = true;
    contexts.push(...segmentContexts);
  }
  if (!detected) return null;
  const uniqueContexts = dedupeNetworkContexts(contexts);
  const hasSingleStaticTarget = !hasUnknownTarget
    && !structure.hasControlOperators
    && !structure.hasDynamicSyntax
    && structure.segments.length === 1
    && uniqueContexts.length === 1;
  // The OS sandbox grants network capability to the process, not a hostname.
  // Even a single static URL can redirect or use proxy/connect-to options.
  const requiresCommandWideApproval = true;
  return {
    reason: '命令需要整条进程级网络访问，不能安全地限制到单一主机。',
    contexts: uniqueContexts,
    requiresCommandWideApproval,
    ...(hasSingleStaticTarget ? { context: uniqueContexts[0] } : {}),
  };
}

export function networkApprovalContextFromTool(toolName: string, parsedArguments: unknown): RuntimeNetworkApprovalContext | null {
  if (toolName !== 'run_shell_command' && toolName !== 'exec_command') return null;
  const record = parsedArguments && typeof parsedArguments === 'object' && !Array.isArray(parsedArguments)
    ? parsedArguments as Record<string, unknown>
    : {};
  const commandValue = record.command ?? record.cmd;
  const command = typeof commandValue === 'string' ? commandValue : '';
  return assessShellNetworkAccess(command)?.context ?? null;
}

export function networkApprovalKeysForContext(context: RuntimeNetworkApprovalContext, environmentId: string): string[] {
  return [
    ['network', environmentId, context.protocol, context.host.toLowerCase(), String(context.port)].join(':'),
  ];
}

function networkContextsFromWords(executable: string, args: string[]): RuntimeNetworkApprovalContext[] {
  if (executable === 'ssh' || executable === 'scp' || executable === 'sftp' || executable === 'rsync') {
    const context = sshLikeNetworkContext(args);
    return context ? [context] : [];
  }
  const urlContexts = allUrlContexts(args);
  if (urlContexts.length) return urlContexts;
  const gitContext = gitSshContext(args);
  return gitContext ? [gitContext] : [];
}

function allUrlContexts(args: string[]): RuntimeNetworkApprovalContext[] {
  return args
    .map(networkContextFromUrl)
    .filter((context): context is RuntimeNetworkApprovalContext => context !== null);
}

function networkContextFromUrl(value: string): RuntimeNetworkApprovalContext | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const protocol = url.protocol === 'https:' ? 'https' : 'http';
    const port = url.port ? Number(url.port) : protocol === 'https' ? 443 : 80;
    if (!url.hostname || !Number.isFinite(port)) return null;
    return {
      host: normalizeHost(url.hostname),
      protocol,
      port,
      target: `${protocol}://${normalizeHost(url.hostname)}:${port}`,
    };
  } catch {
    return null;
  }
}

function gitSshContext(args: string[]): RuntimeNetworkApprovalContext | null {
  for (const arg of args) {
    const match = /^(?:ssh:\/\/)?(?:[^@\s]+@)?([a-z0-9.-]+|\[[a-f0-9:]+\])(?::|\/)/i.exec(arg);
    if (!match) continue;
    const host = normalizeHost(match[1] ?? '');
    if (!host) continue;
    return { host, protocol: 'tcp', port: 22, target: `tcp://${host}:22` };
  }
  return null;
}

function sshLikeNetworkContext(args: string[]): RuntimeNetworkApprovalContext | null {
  let port = 22;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-p' || arg === '-P') {
      const explicitPort = Number(args[index + 1]);
      if (Number.isFinite(explicitPort) && explicitPort > 0) port = explicitPort;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    const host = normalizeHost(arg.split('@').pop()?.split(':')[0] ?? '');
    if (!host || host === '.') continue;
    return { host, protocol: 'tcp', port, target: `tcp://${host}:${port}` };
  }
  return null;
}

function normalizeHost(value: string): string {
  return value.trim().replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function dedupeNetworkContexts(contexts: RuntimeNetworkApprovalContext[]): RuntimeNetworkApprovalContext[] {
  const seen = new Set<string>();
  return contexts.filter((context) => {
    const key = `${context.protocol}:${context.host.toLowerCase()}:${context.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shellExecutableInfo(words: string[]): { executable: string; args: string[] } {
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || '')) index += 1;
  while (['command', 'builtin', 'time', 'noglob'].includes(words[index] ?? '')) index += 1;
  if (words[index] === 'env') {
    index += 1;
    while (words[index]?.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || '')) index += 1;
  }
  const word = words[index] || '';
  return {
    executable: word.split(/[\\/]/).pop() ?? '',
    args: words.slice(index + 1),
  };
}

function parseShellWords(command: string): string[] {
  const words: string[] = [];
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
    current += char;
  }
  if (current) words.push(current);
  return words;
}
