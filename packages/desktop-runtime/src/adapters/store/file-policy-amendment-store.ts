import type {
  RuntimeExecPolicyAmendment,
  RuntimeNetworkApprovalProtocol,
  RuntimeNetworkPolicyAmendment,
} from '@setsuna-desktop/contracts';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PolicyAmendmentStore, RuntimePolicyAmendments } from '../../ports/policy-amendment-store.js';
import { readJsonFile } from './json-file.js';

type StoredPolicyAmendments = RuntimePolicyAmendments;

const policyAppendQueues = new Map<string, Promise<void>>();
const POLICY_LOCK_RETRY_MS = 20;
const POLICY_LOCK_TIMEOUT_MS = 10_000;
const POLICY_LOCK_STALE_MS = 30_000;

export class FilePolicyAmendmentStore implements PolicyAmendmentStore {
  private readonly legacyJsonPath: string;
  private readonly rulesPath: string;

  constructor(private readonly dataDir: string) {
    this.legacyJsonPath = path.join(dataDir, 'policy-amendments.json');
    this.rulesPath = path.join(dataDir, 'rules', 'default.rules');
  }

  async listPolicyAmendments(): Promise<RuntimePolicyAmendments> {
    return mergePolicyAmendments(
      normalizeStoredPolicyAmendments(await readJsonFile<StoredPolicyAmendments>(this.legacyJsonPath, emptyPolicyAmendments())),
      parseRulesPolicyAmendments(await readTextFile(this.rulesPath)),
    );
  }

  async appendExecPolicyAmendment(amendment: RuntimeExecPolicyAmendment): Promise<void> {
    const normalized = normalizeExecPolicyAmendment(amendment);
    if (!normalized.length) return;
    await this.appendRuleLine(prefixRuleLine(normalized));
  }

  async appendNetworkPolicyAmendment(amendment: RuntimeNetworkPolicyAmendment, protocol?: RuntimeNetworkApprovalProtocol): Promise<void> {
    const normalized = normalizeNetworkPolicyAmendment(amendment);
    if (!normalized) return;
    const line = networkRuleLine(normalized, protocol);
    if (line) await this.appendRuleLine(line);
  }

  private async appendRuleLine(line: string): Promise<void> {
    await withPolicyAppendQueue(this.rulesPath, async () => {
      await mkdir(path.dirname(this.rulesPath), { recursive: true });
      await withPolicyFileLock(this.rulesPath, async () => {
        const existing = await readTextFile(this.rulesPath);
        if (existing.split(/\r?\n/).some((item) => item === line)) return;
        const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
        await writeFile(this.rulesPath, `${existing}${prefix}${line}\n`, 'utf8');
      });
    });
  }
}

async function withPolicyAppendQueue<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = policyAppendQueues.get(filePath) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current, () => current);
  policyAppendQueues.set(filePath, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (policyAppendQueues.get(filePath) === queued) policyAppendQueues.delete(filePath);
  }
}

async function withPolicyFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const lockDir = `${filePath}.lock`;
  await acquirePolicyFileLock(lockDir);
  try {
    return await operation();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function acquirePolicyFileLock(lockDir: string): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockDir);
      return;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
    }

    if (await removeStalePolicyFileLock(lockDir)) continue;
    if (Date.now() - startedAt > POLICY_LOCK_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for policy rules lock: ${lockDir}`);
    }
    await sleep(POLICY_LOCK_RETRY_MS);
  }
}

async function removeStalePolicyFileLock(lockDir: string): Promise<boolean> {
  try {
    const stats = await stat(lockDir);
    if (Date.now() - stats.mtimeMs <= POLICY_LOCK_STALE_MS) return false;
    await rm(lockDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === 'ENOENT';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function emptyPolicyAmendments(): RuntimePolicyAmendments {
  return { execPolicyAmendments: [], networkPolicyAmendments: [] };
}

function normalizeStoredPolicyAmendments(value: unknown): RuntimePolicyAmendments {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<RuntimePolicyAmendments> : {};
  return {
    execPolicyAmendments: Array.isArray(record.execPolicyAmendments)
      ? record.execPolicyAmendments.map(normalizeExecPolicyAmendment).filter((item) => item.length > 0)
      : [],
    networkPolicyAmendments: Array.isArray(record.networkPolicyAmendments)
      ? record.networkPolicyAmendments.map(normalizeNetworkPolicyAmendment).filter((item): item is RuntimeNetworkPolicyAmendment => item !== null)
      : [],
  };
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function mergePolicyAmendments(...items: RuntimePolicyAmendments[]): RuntimePolicyAmendments {
  const execPolicyAmendments: RuntimeExecPolicyAmendment[] = [];
  const networkByHost = new Map<string, RuntimeNetworkPolicyAmendment>();
  for (const item of items) {
    for (const amendment of item.execPolicyAmendments) {
      if (!execPolicyAmendments.some((existing) => sameExecPolicyAmendment(existing, amendment))) execPolicyAmendments.push(amendment);
    }
    for (const amendment of item.networkPolicyAmendments) {
      networkByHost.set(amendment.host.toLowerCase(), amendment);
    }
  }
  return { execPolicyAmendments, networkPolicyAmendments: [...networkByHost.values()] };
}

function parseRulesPolicyAmendments(contents: string): RuntimePolicyAmendments {
  const execPolicyAmendments: RuntimeExecPolicyAmendment[] = [];
  const networkPolicyAmendments: RuntimeNetworkPolicyAmendment[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const prefix = parsePrefixRuleLine(line);
    if (prefix.length) execPolicyAmendments.push(prefix);
    const network = parseNetworkRuleLine(line);
    if (network) networkPolicyAmendments.push(network);
  }
  return { execPolicyAmendments, networkPolicyAmendments };
}

function parsePrefixRuleLine(line: string): RuntimeExecPolicyAmendment {
  const match = line.match(/^\s*prefix_rule\((.*)\)\s*$/);
  if (!match) return [];
  const fields = parseRuleFields(match[1] ?? '');
  if (fields.decision !== 'allow') return [];
  const pattern = parseJsonValue(fields.pattern);
  return normalizeExecPolicyAmendment(pattern);
}

function parseNetworkRuleLine(line: string): RuntimeNetworkPolicyAmendment | null {
  const match = line.match(/^\s*network_rule\((.*)\)\s*$/);
  if (!match) return null;
  const fields = parseRuleFields(match[1] ?? '');
  const action = fields.decision === 'allow' || fields.decision === 'deny' ? fields.decision : null;
  return normalizeNetworkPolicyAmendment({ host: fields.host, action });
}

function parseRuleFields(input: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  let index = 0;
  while (index < input.length) {
    while (index < input.length && /[\s,]/.test(input[index] ?? '')) index += 1;
    const keyStart = index;
    while (index < input.length && /[A-Za-z_]/.test(input[index] ?? '')) index += 1;
    const key = input.slice(keyStart, index);
    while (index < input.length && /\s/.test(input[index] ?? '')) index += 1;
    if (!key || input[index] !== '=') break;
    index += 1;
    while (index < input.length && /\s/.test(input[index] ?? '')) index += 1;
    const valueStart = index;
    const value = readRuleFieldValue(input, index);
    index = value.nextIndex;
    fields[key] = parseJsonValue(input.slice(valueStart, index));
  }
  return fields;
}

function readRuleFieldValue(input: string, startIndex: number): { nextIndex: number } {
  let index = startIndex;
  let quote = '';
  let bracketDepth = 0;
  let escaped = false;
  while (index < input.length) {
    const char = input[index] ?? '';
    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }
    if (quote) {
      if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === '[') bracketDepth += 1;
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === ',' && bracketDepth === 0) break;
    index += 1;
  }
  return { nextIndex: index };
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function prefixRuleLine(prefix: RuntimeExecPolicyAmendment): string {
  const pattern = `[${prefix.map((token) => JSON.stringify(token)).join(', ')}]`;
  return `prefix_rule(pattern=${pattern}, decision="allow")`;
}

function networkRuleLine(amendment: RuntimeNetworkPolicyAmendment, protocolInput?: RuntimeNetworkApprovalProtocol): string {
  const protocol = policyProtocol(protocolInput);
  if (!protocol) return '';
  const decision = amendment.action === 'deny' ? 'deny' : 'allow';
  const verb = decision === 'deny' ? 'Deny' : 'Allow';
  return [
    'network_rule(',
    [
      `host=${JSON.stringify(amendment.host.toLowerCase())}`,
      `protocol=${JSON.stringify(protocol)}`,
      `decision=${JSON.stringify(decision)}`,
      `justification=${JSON.stringify(`${verb} ${protocol} access to ${amendment.host.toLowerCase()}`)}`,
    ].join(', '),
    ')',
  ].join('');
}

function policyProtocol(protocol: RuntimeNetworkApprovalProtocol | undefined): 'http' | 'https' | 'socks5_tcp' | 'socks5_udp' | null {
  if (protocol === 'http') return 'http';
  if (protocol === 'https' || protocol === undefined) return 'https';
  if (protocol === 'socks5-tcp') return 'socks5_tcp';
  if (protocol === 'socks5-udp') return 'socks5_udp';
  return null;
}

function normalizeExecPolicyAmendment(value: unknown): RuntimeExecPolicyAmendment {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : [];
}

function normalizeNetworkPolicyAmendment(value: unknown): RuntimeNetworkPolicyAmendment | null {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<RuntimeNetworkPolicyAmendment> : {};
  const host = normalizeNetworkRuleHost(record.host);
  const action = record.action === 'allow' || record.action === 'deny' ? record.action : null;
  return host && action ? { host, action } : null;
}

function normalizeNetworkRuleHost(value: unknown): string {
  let host = typeof value === 'string' ? value.trim() : '';
  if (!host) return '';
  if (host.includes('://') || host.includes('/') || host.includes('?') || host.includes('#')) return '';

  if (host.startsWith('[')) {
    const closeIndex = host.indexOf(']');
    if (closeIndex < 0) return '';
    const inside = host.slice(1, closeIndex);
    const rest = host.slice(closeIndex + 1);
    const port = rest.startsWith(':') ? rest.slice(1) : '';
    if (rest && !(port && /^\d+$/u.test(port))) return '';
    host = inside;
  } else if ((host.match(/:/gu)?.length ?? 0) === 1) {
    const separatorIndex = host.lastIndexOf(':');
    const candidate = host.slice(0, separatorIndex);
    const port = host.slice(separatorIndex + 1);
    if (candidate && port && /^\d+$/u.test(port)) host = candidate;
  }

  const normalized = host.replace(/\.+$/u, '').trim().toLowerCase();
  if (!normalized || normalized.includes('*') || /\s/u.test(normalized)) return '';
  return normalized;
}

function sameExecPolicyAmendment(left: RuntimeExecPolicyAmendment, right: RuntimeExecPolicyAmendment): boolean {
  return left.length === right.length && left.every((word, index) => word === right[index]);
}
