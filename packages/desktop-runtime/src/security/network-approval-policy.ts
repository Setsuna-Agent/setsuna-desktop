export type RuntimeNetworkApprovalProtocol = 'http' | 'https' | 'socks5-tcp' | 'socks5-udp' | 'tcp' | 'unknown';

export type RuntimeNetworkApprovalContext = {
  host: string;
  protocol: RuntimeNetworkApprovalProtocol;
  port: number;
  target: string;
};

export type ShellNetworkAssessment = {
  reason: string;
  context?: RuntimeNetworkApprovalContext;
};

const DIRECT_NETWORK_COMMANDS = new Set(['curl', 'wget', 'ssh', 'scp', 'sftp', 'ftp', 'rsync', 'telnet', 'nc', 'ncat']);
const JS_PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PYTHON_PACKAGE_MANAGERS = new Set(['pip', 'pip3', 'uv']);
const DEPLOY_CLIS = new Set(['vercel', 'netlify', 'firebase', 'wrangler']);

export function assessShellNetworkAccess(command: string): ShellNetworkAssessment | null {
  for (const words of shellCommandSegments(command.toLowerCase())) {
    const { executable, args } = shellExecutableInfo(words);
    if (!executable) continue;
    const context = networkContextFromWords(executable, args);
    if (DIRECT_NETWORK_COMMANDS.has(executable)) {
      return { reason: '命令可能访问网络或远程系统。', ...(context ? { context } : {}) };
    }
    if (executable === 'git' && ['clone', 'fetch', 'pull', 'push', 'ls-remote'].includes(args[0] ?? '')) {
      return { reason: 'Git 命令可能访问远端仓库。', ...(context ? { context } : {}) };
    }
    if (executable === 'git' && args[0] === 'submodule' && args[1] === 'update') {
      return { reason: 'Git submodule 更新可能访问远端仓库。', ...(context ? { context } : {}) };
    }
    if (JS_PACKAGE_MANAGERS.has(executable) && ['install', 'i', 'add', 'update', 'upgrade', 'publish', 'release'].includes(args[0] ?? '')) {
      return { reason: '包管理命令可能访问软件源或发布服务。', ...(context ? { context } : {}) };
    }
    if (PYTHON_PACKAGE_MANAGERS.has(executable) && ['install', 'sync', 'add', 'publish'].includes(args[0] ?? '')) {
      return { reason: 'Python 包管理命令可能访问软件源或发布服务。', ...(context ? { context } : {}) };
    }
    if (executable === 'cargo' && ['install', 'update', 'publish'].includes(args[0] ?? '')) {
      return { reason: 'Cargo 命令可能访问软件源或发布服务。', ...(context ? { context } : {}) };
    }
    if (executable === 'go' && (args[0] === 'get' || args[0] === 'install' || (args[0] === 'mod' && args[1] === 'download'))) {
      return { reason: 'Go 命令可能访问模块代理或远端仓库。', ...(context ? { context } : {}) };
    }
    if (DEPLOY_CLIS.has(executable) && ['deploy', 'publish', 'login'].includes(args[0] ?? '')) {
      return { reason: '命令可能访问线上服务。', ...(context ? { context } : {}) };
    }
  }
  return null;
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

function networkContextFromWords(executable: string, args: string[]): RuntimeNetworkApprovalContext | null {
  if (executable === 'ssh' || executable === 'scp' || executable === 'sftp' || executable === 'rsync') {
    return sshLikeNetworkContext(args);
  }
  return firstUrlContext(args) ?? gitSshContext(args);
}

function firstUrlContext(args: string[]): RuntimeNetworkApprovalContext | null {
  for (const arg of args) {
    const context = networkContextFromUrl(arg);
    if (context) return context;
  }
  return null;
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

function shellCommandSegments(command: string): string[][] {
  return String(command || '')
    .split(/[;&|]+/)
    .map((segment) => parseShellWords(segment))
    .filter((words) => words.length > 0);
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
