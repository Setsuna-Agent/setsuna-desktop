import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import { isRecord, stringField } from './runtimeToolRunPresentationUtils.js';

export function execPolicyApprovalSummary(run: RuntimeToolRun): string {
  const prefix = run.proposedExecPolicyAmendment?.filter(Boolean) ?? [];
  return prefix.length ? `allow prefix: ${prefix.join(' ')}` : '';
}

export function networkApprovalSummary(run: RuntimeToolRun): string {
  const context = run.networkApprovalContext;
  if (!context) return '';
  const allowAmendments = run.proposedNetworkPolicyAmendments
    ?.filter((item) => item.action === 'allow' && item.host)
    .map((item) => item.host);
  const denyAmendments = run.proposedNetworkPolicyAmendments
    ?.filter((item) => item.action === 'deny' && item.host)
    .map((item) => item.host);
  return [
    `target: ${context.target}`,
    `protocol: ${context.protocol}`,
    allowAmendments?.length ? `policy allow: ${[...new Set(allowAmendments)].join(', ')}` : '',
    denyAmendments?.length ? `policy deny: ${[...new Set(denyAmendments)].join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

export function permissionApprovalSummary(run: RuntimeToolRun): string {
  const context = run.permissionApprovalContext;
  if (!context) return '';
  const granted = isRecord(context.grantedPermissions) ? context.grantedPermissions : {};
  const network = isRecord(granted.network) && granted.network.enabled === true;
  const readRoots = permissionFileRoots(granted.file_system ?? granted.fileSystem, 'read');
  const writeRoots = permissionWriteRoots(granted.file_system ?? granted.fileSystem);
  const lines = [
    context.cwd ? `cwd: ${context.cwd}` : '',
    network ? 'network: enabled' : '',
    readRoots.length ? `read: ${readRoots.slice(0, 5).join(', ')}${readRoots.length > 5 ? ` +${readRoots.length - 5}` : ''}` : '',
    writeRoots.length ? `write: ${writeRoots.slice(0, 5).join(', ')}${writeRoots.length > 5 ? ` +${writeRoots.length - 5}` : ''}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function permissionWriteRoots(value: unknown): string[] {
  return permissionFileRoots(value, 'write');
}

function permissionFileRoots(value: unknown, access: 'read' | 'write'): string[] {
  const fileSystem = isRecord(value) ? value : {};
  const roots = new Set<string>();
  const legacyRoots = access === 'write' ? fileSystem.write : fileSystem.read;
  if (Array.isArray(legacyRoots)) {
    for (const item of legacyRoots) {
      const root = stringField(item);
      if (root) roots.add(root);
    }
  }
  if (Array.isArray(fileSystem.entries)) {
    for (const item of fileSystem.entries) {
      if (!isRecord(item) || item.access !== access) continue;
      const pathValue = isRecord(item.path) ? stringField(item.path.path) : stringField(item.path);
      if (pathValue) roots.add(pathValue);
    }
  }
  return [...roots];
}
