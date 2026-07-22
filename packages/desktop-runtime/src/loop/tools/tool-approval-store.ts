import type { RuntimeSandboxWorkspaceWrite } from '@setsuna-desktop/contracts';
import {
  isEmptySandboxWorkspaceWrite,
  mergeSandboxWorkspaceWrite,
  type RequestPermissionGrantScope,
} from './tool-orchestrator-policy.js';

export class ToolApprovalStore {
  private readonly approvedForSession = new Set<string>();
  private readonly approvedForTurn = new Map<string, Set<string>>();
  private readonly sessionSandboxGrants = new Map<string, RuntimeSandboxWorkspaceWrite>();
  private readonly turnSandboxGrants = new Map<string, Map<string, RuntimeSandboxWorkspaceWrite>>();
  private readonly strictAutoReviewTurns = new Set<string>();

  hasAll(keys: string[], turnId?: string): boolean {
    const turnKeys = turnId ? this.approvedForTurn.get(turnId) : undefined;
    return keys.length > 0 && keys.every((key) => this.approvedForSession.has(key) || Boolean(turnKeys?.has(key)));
  }

  hasAny(keys: string[], turnId?: string): boolean {
    const turnKeys = turnId ? this.approvedForTurn.get(turnId) : undefined;
    return keys.some((key) => this.approvedForSession.has(key) || Boolean(turnKeys?.has(key)));
  }

  approveForSession(keys: string[]): void {
    for (const key of keys) {
      if (key) this.approvedForSession.add(key);
    }
  }

  approveForTurn(turnId: string, keys: string[]): void {
    if (!turnId) return;
    let turnKeys = this.approvedForTurn.get(turnId);
    if (!turnKeys) {
      turnKeys = new Set<string>();
      this.approvedForTurn.set(turnId, turnKeys);
    }
    for (const key of keys) {
      if (key) turnKeys.add(key);
    }
  }

  enableStrictAutoReviewForTurn(turnId: string): void {
    if (turnId) this.strictAutoReviewTurns.add(turnId);
  }

  strictAutoReviewEnabled(turnId: string): boolean {
    return Boolean(turnId && this.strictAutoReviewTurns.has(turnId));
  }

  grantSandboxPermissions(scope: RequestPermissionGrantScope, turnId: string, environmentId: string, sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite): void {
    if (!environmentId || isEmptySandboxWorkspaceWrite(sandboxWorkspaceWrite)) return;
    if (scope === 'session') {
      this.sessionSandboxGrants.set(environmentId, mergeSandboxWorkspaceWrite(this.sessionSandboxGrants.get(environmentId), sandboxWorkspaceWrite));
      return;
    }
    if (!turnId) return;
    let grants = this.turnSandboxGrants.get(turnId);
    if (!grants) {
      grants = new Map<string, RuntimeSandboxWorkspaceWrite>();
      this.turnSandboxGrants.set(turnId, grants);
    }
    grants.set(environmentId, mergeSandboxWorkspaceWrite(grants.get(environmentId), sandboxWorkspaceWrite));
  }

  sandboxWorkspaceWriteFor(turnId: string, environmentId: string): RuntimeSandboxWorkspaceWrite {
    return mergeSandboxWorkspaceWrite(
      this.sessionSandboxGrants.get(environmentId),
      this.turnSandboxGrants.get(turnId)?.get(environmentId),
    );
  }

  clearTurn(turnId: string): void {
    this.approvedForTurn.delete(turnId);
    this.turnSandboxGrants.delete(turnId);
    this.strictAutoReviewTurns.delete(turnId);
  }
}
