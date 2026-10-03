import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { ComputerCommand, ComputerContext, ComputerControlPort, ComputerIdentity, ComputerRuntimeToolService, ComputerToolResult, ComputerStopReason, ComputerToolApprovalRequirement } from '../contracts/index.js';
import { ComputerControlError, parseComputerAction } from '../contracts/index.js';
import { record, string } from '../contracts/validation.js';
import { computerObservation, computerWindowList } from './observation.js';
import { computerToolDefinitions } from './tool-definitions.js';

export class ComputerRuntimeTools implements ComputerRuntimeToolService {
  // A pending start is tracked too: a lost HTTP response must not orphan native input.
  private readonly sessions = new Map<string, { id?: string }>();
  constructor(private readonly control: ComputerControlPort | null) {}

  async listTools(context: ComputerContext): Promise<RuntimeToolDefinition[]> {
    if (!this.control || context.readOnly || context.modelCapabilities?.supportsImages !== true) return [];
    return await this.control.isEnabled().catch(() => false) ? computerToolDefinitions : [];
  }
  approvalForTool(name: string, context: ComputerContext): ComputerToolApprovalRequirement | null {
    return name === 'computer_start' ? {
      reason: '电脑控制会读取所选窗口或桌面，并向目标应用发送鼠标和键盘输入。',
      approvalKeys: [`computer-control:${context.threadId}`],
    } : null;
  }

  async runTool(name: string, input: unknown, context: ComputerContext): Promise<ComputerToolResult> {
    if (!this.control) throw new Error('Desktop control is not connected.');
    const identity = executionIdentity(context);
    if (name !== 'computer_stop' && (identity.readOnly || !identity.supportsImages)) throw new Error('Read-only/non-image turns cannot use desktop control.');
    const key = turnKey(context);
    let command: ComputerCommand;
    // Model arguments never select a session or supply trusted task identity.
    // Validation happens before execution, so malformed calls preserve the session.
    switch (name) {
      case 'computer_windows':
        record(input, []);
        command = { kind: 'windows', identity };
        break;
      case 'computer_start': {
        const args = record(input, ['windowId']);
        command = { kind: 'start', identity, ...(args.windowId === undefined ? {} : { windowId: string(args.windowId) }) };
        if (!this.sessions.has(key)) this.sessions.set(key, {});
        break;
      }
      case 'computer_stop':
        record(input, []);
        command = { kind: 'stop', identity };
        break;
      case 'computer_screenshot':
        record(input, []);
        command = { kind: 'screenshot', identity, sessionId: this.sessionId(key) };
        break;
      case 'computer_action': {
        const args = record(input, ['observationId', 'action']);
        command = { kind: 'action', identity, sessionId: this.sessionId(key), observationId: string(args.observationId), action: parseComputerAction(args.action) };
        break;
      }
      default: throw new Error(`Unknown tool: ${name}`);
    }
    const session = this.sessions.get(key);
    let failureReason: ComputerStopReason = 'tool-failed';
    try {
      const result = await this.control.execute(command, context.signal);
      if (result.kind === 'stopped') {
        this.sessions.delete(key);
        return { content: 'Desktop control stopped.' };
      }
      if (result.kind === 'windows') return { content: JSON.stringify(computerWindowList(result)), data: result, containsExternalContext: true };
      if (!session || this.sessions.get(key) !== session) throw new Error('Desktop turn ended before the observation arrived.');
      const { dataUrl, sessionId, ...metadata } = result;
      session.id = sessionId;
      failureReason = 'image-invalid';
      if (!dataUrl.startsWith('data:image/png;base64,') || !result.size || !result.width || !result.height) throw new Error('Desktop image is missing; control stopped.');
      return {
        content: JSON.stringify(computerObservation(result)), data: metadata, containsExternalContext: true,
        attachments: [{ id: `computer_${result.observationId}`, name: result.scope === 'window' ? 'window-screenshot.png' : 'desktop-screenshot.png', type: 'image/png', size: result.size, url: dataUrl }],
      };
    } catch (error) {
      if (this.sessions.get(key) === session) {
        if (error instanceof ComputerControlError) {
          // Main owns operation recovery and teardown; do not turn an admission
          // rejection into a second stop that destroys a still-valid session.
          if (error.failure.sessionState === 'closed') this.sessions.delete(key);
        } else {
          await this.cleanupTurn(context, failureReason).catch(() => undefined);
        }
      }
      throw error;
    }
  }

  private sessionId(key: string): string {
    const id = this.sessions.get(key)?.id;
    if (!id) throw new Error('No desktop session is active for this turn. Call computer_start first.');
    return id;
  }

  async cleanupTurn(context: ComputerContext, reason: ComputerStopReason = 'turn-cleanup'): Promise<void> {
    if (!this.control || !context.turnId || !this.sessions.delete(turnKey(context))) return;
    // Cleanup is intentionally independent of the cancelled turn signal.
    await this.control.execute({ kind: 'stop', identity: executionIdentity(context), reason });
  }
}
function turnKey(context: ComputerContext): string {
  return JSON.stringify([context.threadId, context.turnId]);
}
function executionIdentity(context: ComputerContext): ComputerIdentity {
  if (!context.turnId || !context.threadId) throw new Error('Desktop control requires a runtime turn identity.');
  return { threadId: context.threadId, turnId: context.turnId, unattended: context.unattended === true, readOnly: context.readOnly === true, supportsImages: context.modelCapabilities?.supportsImages === true };
}
