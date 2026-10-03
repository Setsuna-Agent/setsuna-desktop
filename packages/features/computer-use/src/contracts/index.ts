import { defineFeature } from '@setsuna-desktop/feature-core/definition';
import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import type { RuntimeMessageAttachment, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { ComputerModifier } from './keyboard.js';
export { computerNavigationKeys, computerModifiers, computerStopShortcuts, parseComputerKeystroke, type ComputerModifier } from './keyboard.js';
export { computerCommandTimeout, type WindowsInputRequest } from './windows-input.js';
export { ComputerControlError, type ComputerControlFailure, type ComputerControlErrorCode } from './errors.js';

export const computerUseFeature = defineFeature('computer-use');
export const computerUseChannels = {
  status: 'computer-use:status', preview: 'computer-use:preview', stop: 'computer-use:stop',
  settings: 'computer-use:settings', setEnabled: 'computer-use:set-enabled',
  requestPermission: 'computer-use:request-permission',
} as const;
export type ComputerIdentity = { threadId: string; turnId: string; unattended: boolean; readOnly: boolean; supportsImages: boolean };
export type ComputerContext = {
  threadId: string; turnId?: string; unattended?: boolean; readOnly?: boolean;
  modelCapabilities?: { supportsImages: boolean }; signal?: AbortSignal; toolCallId?: string;
};
export type ComputerAction =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string; modifiers?: ComputerModifier[] }
  | { kind: 'scroll'; x: number; y: number; direction: 'up' | 'down'; amount: number };
export type ComputerStopReason = 'requested' | 'turn-cleanup' | 'tool-failed' | 'image-invalid' | 'image-delivery-failed';
export type ComputerCommand = { identity: ComputerIdentity } & (
  | { kind: 'windows' }
  | { kind: 'start'; windowId?: string }
  | { kind: 'stop'; reason?: ComputerStopReason }
  | { kind: 'screenshot'; sessionId: string }
  | { kind: 'action'; sessionId: string; observationId: string; action: ComputerAction }
);
export type ComputerDisplay = {
  id: number; bounds: { x: number; y: number; width: number; height: number }; scaleFactor: number;
  inputBounds: { x: number; y: number; width: number; height: number };
  inputCoordinateSpace: 'macos-points' | 'windows-physical-pixels';
};
export type ComputerCaptureMetadata = {
  backend: 'electron-desktop-capturer'; sourceDisplayId: string;
  nearBlackFraction: number; transparentFraction: number; contrast: number; interiorContrast: number;
};
export type ComputerWindow = {
  id: string; pid: number; windowNumber: number; application: string; title: string;
  bounds: { x: number; y: number; width: number; height: number };
};
export type ComputerTarget =
  | { scope: 'primary-desktop'; display: ComputerDisplay }
  | { scope: 'window'; window: ComputerWindow };
export type ComputerImage = {
  width: number; height: number; dataUrl: string; size: number;
  capture: ComputerCaptureMetadata | { backend: 'macos-window'; sourceWindowId: string };
};
export type ComputerFrame = ComputerImage & ComputerTarget & {
  kind: 'frame'; sessionId: string; observationId: string; capturedAt: number;
  coordinateSpace: 'screenshot-pixels';
  inputDispatched?: boolean;
  actionError?: string;
};
export type ComputerWindows = { kind: 'windows' } & (
  | { mode: 'background-window'; windows: ComputerWindow[] }
  | { mode: 'foreground-desktop' }
);
export type ComputerResult = ComputerFrame | ComputerWindows | { kind: 'stopped' };
export type ComputerStatus = { active: boolean; threadId?: string };
export type ComputerPreviewFrame = Pick<ComputerFrame, 'dataUrl' | 'width' | 'height' | 'observationId'>;
export type ComputerPreview = ComputerStatus & { frame: ComputerPreviewFrame | null };
export type ComputerPermissionStatus = 'granted' | 'not-determined' | 'denied' | 'restricted' | 'unknown' | 'not-required' | 'unsupported';
export type ComputerPermission = 'screen' | 'accessibility' | 'administrator';
export type ComputerPermissions = { screen: ComputerPermissionStatus; accessibility: ComputerPermissionStatus; administrator?: ComputerPermissionStatus };
export type ComputerSettings = { enabled: boolean; permissions: ComputerPermissions };
export type ComputerConnection = { url: string; token: string };
export interface ComputerControlPort {
  isEnabled(): Promise<boolean>;
  execute(command: ComputerCommand, signal?: AbortSignal): Promise<ComputerResult>;
}
export interface ComputerBridge {
  status(): Promise<ComputerStatus>;
  preview(): Promise<ComputerPreview>;
  stop(): Promise<void>;
  settings(): Promise<ComputerSettings>;
  setEnabled(enabled: boolean): Promise<ComputerSettings>;
  requestPermission(permission: ComputerPermission): Promise<void>;
}
export type ComputerPreloadContribution = { computerUse: ComputerBridge };
export type ComputerToolResult = { content: string; attachments?: RuntimeMessageAttachment[]; containsExternalContext?: boolean; data?: unknown };
export type ComputerToolApprovalRequirement = {
  reason: string;
  argumentsPreview?: string;
  approvalKeys?: string[];
};
export interface ComputerRuntimeToolService {
  approvalForTool(name: string, context: ComputerContext): ComputerToolApprovalRequirement | null;
  listTools(context: ComputerContext): Promise<RuntimeToolDefinition[]>;
  runTool(name: string, input: unknown, context: ComputerContext): Promise<ComputerToolResult>;
  cleanupTurn(context: ComputerContext, reason?: ComputerStopReason): Promise<void>;
}
export const computerRuntimeToolsCapability = defineCapability<ComputerRuntimeToolService>({ id: 'computer-use.runtime-tools', description: 'Supervised desktop tool service' });
export const computerBridgeCapability = defineCapability<ComputerBridge>({ id: 'computer-use.renderer-bridge', description: 'Manage desktop control settings, permissions and stopping' });
export { parseComputerCommand, parseComputerAction } from './validation.js';
