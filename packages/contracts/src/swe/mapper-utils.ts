import type {
  RuntimeApprovalAvailableDecision,
  RuntimeNetworkApprovalContext
} from '../approvals.js';
import type {
  SweAdditionalPermissionProfile,
  SweCommandAction,
  SweCommandExecutionApprovalDecision,
  SweNetworkApprovalContext,
  SweNetworkApprovalProtocol,
} from './types.js';

export function recordFromJson(value: string | undefined): Record<string, unknown> {
  const parsed = parseJson(value);
  return isRecord(parsed) ? parsed : {};
}

export function parseJson(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function recordInput(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function swePermissionProfile(value: unknown): Record<string, unknown> {
  const permissions = recordInput(value);
  const network = recordInput(permissions.network);
  const fileSystem = recordInput(permissions.file_system ?? permissions.fileSystem);
  const result: Record<string, unknown> = {};
  if (network.enabled === true) result.network = { enabled: true };
  const fileSystemResult = sweFileSystemPermissions(fileSystem);
  if (fileSystemResult) result.fileSystem = fileSystemResult;
  return result;
}

export function sweAdditionalPermissionProfile(value: unknown): SweAdditionalPermissionProfile | null {
  const permissions = swePermissionProfile(value);
  return Object.keys(permissions).length ? permissions : null;
}

export function sweFileSystemPermissions(fileSystem: Record<string, unknown>): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  const read = stringList(fileSystem.read ?? fileSystem.read_roots ?? fileSystem.readRoots);
  const write = stringList(fileSystem.write ?? fileSystem.writable_roots ?? fileSystem.writableRoots);
  const entries = Array.isArray(fileSystem.entries)
    ? fileSystem.entries.map(sweFileSystemEntry).filter((entry): entry is Record<string, unknown> => entry !== null)
    : [];
  const globScanMaxDepth = numberField(fileSystem.glob_scan_max_depth ?? fileSystem.globScanMaxDepth);
  if (read.length) result.read = read;
  if (write.length) result.write = write;
  if (globScanMaxDepth !== null) result.globScanMaxDepth = globScanMaxDepth;
  if (entries.length) result.entries = entries;
  return Object.keys(result).length ? result : null;
}

export function sweFileSystemEntry(value: unknown): Record<string, unknown> | null {
  const entry = recordInput(value);
  const access = stringField(entry.access);
  const pathValue = sweFileSystemPath(entry.path);
  if (!pathValue || !['read', 'write', 'deny'].includes(access)) return null;
  return { path: pathValue, access };
}

export function sweFileSystemPath(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') return { type: 'path', path: value };
  const record = recordInput(value);
  const type = stringField(record.type);
  if (!type || type === 'path') {
    const pathValue = stringField(record.path);
    return pathValue ? { type: 'path', path: pathValue } : null;
  }
  if (type === 'glob_pattern' || type === 'globPattern') {
    const pattern = stringField(record.pattern);
    return pattern ? { type: 'globPattern', pattern } : null;
  }
  if (type === 'special') {
    const valueRecord = recordInput(record.value);
    const kind = stringField(valueRecord.kind ?? record.value);
    if (!kind) return null;
    const specialValue: Record<string, unknown> = { kind };
    const subpath = stringField(valueRecord.subpath);
    if (subpath) specialValue.subpath = subpath;
    return { type: 'special', value: specialValue };
  }
  return null;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : [];
}

export function sweNetworkApprovalContext(context: RuntimeNetworkApprovalContext | undefined): SweNetworkApprovalContext | null {
  if (!context?.host) return null;
  const protocol = sweNetworkApprovalProtocol(context.protocol);
  if (!protocol) return null;
  return { host: context.host, protocol };
}

export function sweNetworkApprovalProtocol(protocol: RuntimeNetworkApprovalContext['protocol']): SweNetworkApprovalProtocol | null {
  if (protocol === 'http' || protocol === 'https') return protocol;
  if (protocol === 'socks5-tcp') return 'socks5Tcp';
  if (protocol === 'socks5-udp') return 'socks5Udp';
  return null;
}

export function sweCommandExecutionApprovalDecisions(decisions: RuntimeApprovalAvailableDecision[] | undefined): SweCommandExecutionApprovalDecision[] | null {
  if (!decisions?.length) return null;
  const mapped = decisions
    .map(sweCommandExecutionApprovalDecision)
    .filter((decision): decision is SweCommandExecutionApprovalDecision => decision !== null);
  return mapped.length ? mapped : null;
}

export function sweCommandExecutionApprovalDecision(decision: RuntimeApprovalAvailableDecision): SweCommandExecutionApprovalDecision | null {
  switch (decision.type) {
    case 'approve':
      return 'accept';
    case 'approve_for_session':
      return 'acceptForSession';
    case 'approve_persistently':
      return 'acceptAndRemember';
    case 'approve_exec_policy_amendment':
      return { acceptWithExecpolicyAmendment: { execpolicy_amendment: decision.proposedExecPolicyAmendment } };
    case 'approve_network_policy_amendment':
      return { applyNetworkPolicyAmendment: { network_policy_amendment: decision.networkPolicyAmendment } };
    case 'reject':
      return 'decline';
    case 'cancel':
      return 'cancel';
    case 'approve_for_turn_with_strict_auto_review':
      return null;
  }
}

export function commandActionsForShellCommand(command: string | null | undefined, cwd: string | null | undefined): SweCommandAction[] {
  const text = command?.trim();
  if (!text) return [];
  return splitShellCommandSegments(text).map((segment) => commandActionForShellSegment(segment, cwd || '.'));
}

export function commandActionForShellSegment(segment: string, cwd: string): SweCommandAction {
  const words = shellWords(segment);
  const [head, ...tail] = words;
  if (!head) return { type: 'unknown', command: segment };

  if (['ls', 'eza', 'exa', 'tree', 'du'].includes(head)) {
    const pathValue = firstNonFlagOperand(tail, listCommandFlagsWithValues(head));
    return { type: 'listFiles', command: segment, path: pathValue ? shortDisplayPath(pathValue) : null };
  }

  if (['rg', 'rga', 'ripgrep-all'].includes(head)) {
    const candidates = skipFlagValues(trimAtConnector(tail), ['-g', '--glob', '--iglob', '-t', '--type', '--type-add', '--type-not', '-m', '--max-count', '-A', '-B', '-C', '--context', '--max-depth'])
      .filter((item) => !item.startsWith('-'));
    if (tail.includes('--files')) {
      return { type: 'listFiles', command: segment, path: candidates[0] ? shortDisplayPath(candidates[0]) : null };
    }
    return { type: 'search', command: segment, query: candidates[0] ?? null, path: candidates[1] ? shortDisplayPath(candidates[1]) : null };
  }

  if (head === 'git' && tail[0] === 'grep') return grepLikeCommandAction(segment, tail.slice(1));
  if (head === 'git' && tail[0] === 'ls-files') {
    const pathValue = firstNonFlagOperand(tail.slice(1), ['--exclude', '--exclude-from', '--pathspec-from-file']);
    return { type: 'listFiles', command: segment, path: pathValue ? shortDisplayPath(pathValue) : null };
  }

  if (['grep', 'egrep', 'fgrep', 'ag', 'ack', 'pt'].includes(head)) return grepLikeCommandAction(segment, tail);

  if (head === 'find') {
    const pathValue = tail.find((item) => item && !item.startsWith('-') && item !== '(' && item !== ')') ?? null;
    const nameIndex = tail.findIndex((item) => item === '-name' || item === '-iname');
    const query = nameIndex >= 0 ? tail[nameIndex + 1] ?? null : null;
    return query
      ? { type: 'search', command: segment, query, path: pathValue ? shortDisplayPath(pathValue) : null }
      : { type: 'listFiles', command: segment, path: pathValue ? shortDisplayPath(pathValue) : null };
  }

  if (head === 'fd') {
    const operands = skipFlagValues(tail, ['-d', '--max-depth', '-e', '--extension', '-t', '--type']).filter((item) => !item.startsWith('-'));
    return operands[0]
      ? { type: 'search', command: segment, query: operands[0], path: operands[1] ? shortDisplayPath(operands[1]) : null }
      : { type: 'listFiles', command: segment, path: null };
  }

  if (['cat', 'bat', 'batcat', 'less', 'more', 'head', 'tail', 'nl', 'sed', 'awk'].includes(head)) {
    const filePath = readCommandPath(head, tail);
    if (filePath) {
      return {
        type: 'read',
        command: segment,
        name: shortDisplayPath(filePath),
        path: resolveCommandActionPath(filePath, cwd),
      };
    }
  }

  return { type: 'unknown', command: segment };
}

export function grepLikeCommandAction(command: string, args: string[]): SweCommandAction {
  const candidates = skipFlagValues(trimAtConnector(args), ['-e', '-f', '-m', '--max-count', '-A', '-B', '-C', '--context', '--exclude', '--exclude-dir', '--include'])
    .filter((item) => !item.startsWith('-'));
  return { type: 'search', command, query: candidates[0] ?? null, path: candidates[1] ? shortDisplayPath(candidates[1]) : null };
}

export function readCommandPath(commandName: string, args: string[]): string | null {
  const flagsWithValuesByCommand: Record<string, string[]> = {
    bat: ['--theme', '--language', '--style', '--terminal-width', '--tabs', '--line-range', '--map-syntax'],
    batcat: ['--theme', '--language', '--style', '--terminal-width', '--tabs', '--line-range', '--map-syntax'],
    less: ['-p', '-P', '-x', '-y', '-z', '-j', '--pattern', '--prompt', '--tabs', '--shift', '--jump-target'],
    head: ['-n', '--lines', '-c', '--bytes', '-q', '-v'],
    tail: ['-n', '--lines', '-c', '--bytes', '-q', '-v'],
    nl: ['-s', '-w', '-v', '-i', '-b'],
  };
  const candidates = skipFlagValues(args, flagsWithValuesByCommand[commandName] ?? []).filter((item) => !item.startsWith('-'));
  if (commandName === 'sed' || commandName === 'awk') return candidates.length >= 2 ? candidates[candidates.length - 1] : null;
  return candidates.length === 1 ? candidates[0] : null;
}

export function splitShellCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];
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
    if (char === ';' || char === '\n' || (char === '&' && next === '&') || char === '|') {
      const segment = current.trim();
      if (segment) segments.push(segment);
      current = '';
      if ((char === '&' && next === '&') || (char === '|' && next === '|')) index += 1;
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) segments.push(tail);
  return segments.length ? segments : [command.trim()];
}

export function shellWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const char of command) {
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

export function firstNonFlagOperand(args: string[], flagsWithValues: string[]): string | null {
  return skipFlagValues(args, flagsWithValues).find((item) => !item.startsWith('-')) ?? null;
}

export function skipFlagValues(args: string[], flagsWithValues: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item) continue;
    const hasSeparateValue = flagsWithValues.includes(item);
    if (hasSeparateValue) {
      index += 1;
      continue;
    }
    if (flagsWithValues.some((flag) => item.startsWith(`${flag}=`) || (flag.length === 2 && item.startsWith(flag) && item.length > 2))) continue;
    if (item.startsWith('-')) continue;
    values.push(item);
  }
  return values;
}

export function trimAtConnector(args: string[]): string[] {
  const index = args.findIndex((item) => ['&&', '||', ';', '|'].includes(item));
  return index >= 0 ? args.slice(0, index) : args;
}

export function listCommandFlagsWithValues(commandName: string): string[] {
  if (commandName === 'ls') return ['-I', '-w', '--block-size', '--format', '--time-style', '--color', '--quoting-style'];
  if (commandName === 'tree') return ['-L', '-P', '-I', '--charset', '--filelimit', '--sort'];
  if (commandName === 'du') return ['-d', '--max-depth', '-B', '--block-size', '--exclude', '--time-style'];
  return ['-I', '--ignore-glob', '--color', '--sort', '--time-style', '--time'];
}

export function shortDisplayPath(value: string): string {
  return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? value;
}

export function resolveCommandActionPath(filePath: string, cwd: string): string {
  if (!filePath || /^(?:[a-zA-Z]:[\\/]|\/|\\\\|[a-zA-Z][a-zA-Z\d+.-]*:)/.test(filePath)) return filePath;
  const base = cwd || '.';
  if (base === '.') return filePath;
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${separator}${filePath}`;
}

export function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function durationFromShellData(data: Record<string, unknown>): number | null {
  const started = numberField(data.started_at_ms);
  const finished = numberField(data.finished_at_ms);
  return started === null || finished === null ? null : Math.max(0, finished - started);
}

export function toEpochMs(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function toEpochSeconds(value: string): number {
  return Math.floor(toEpochMs(value) / 1000);
}

export function minPositiveMs(values: number[]): number | null {
  const positive = values.filter((value) => value > 0);
  return positive.length ? Math.min(...positive) : null;
}

export function compareNullableMs(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

export function minEpochSeconds(values: string[]): number | null {
  const times = values.map(toEpochMs).filter((value) => value > 0);
  return times.length ? Math.floor(Math.min(...times) / 1000) : null;
}

export function maxEpochSeconds(values: string[]): number | null {
  const times = values.map(toEpochMs).filter((value) => value > 0);
  return times.length ? Math.floor(Math.max(...times) / 1000) : null;
}
