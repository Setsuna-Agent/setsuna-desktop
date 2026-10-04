export const SANDBOX_DIALOG_PATH = '/v1/sandbox-dialogs/';

export type SandboxDialogSession = Readonly<{ id: string; url: string }>;
export type SandboxDialogRequest = Readonly<{
  kind: 'alert' | 'confirm' | 'prompt';
  message: string;
  defaultValue?: string;
}>;
export type SandboxDialogResult = string | boolean | null;

export function parseSandboxDialogRequest(value: unknown): SandboxDialogRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid dialog request.');
  const input = value as Record<string, unknown>;
  if (input.kind !== 'alert' && input.kind !== 'confirm' && input.kind !== 'prompt') throw new Error('Invalid dialog kind.');
  if (typeof input.message !== 'string' || input.message.length > 16_384) throw new Error('Invalid dialog message.');
  if (input.defaultValue !== undefined && (typeof input.defaultValue !== 'string' || input.defaultValue.length > 16_384)) {
    throw new Error('Invalid dialog default value.');
  }
  return {
    kind: input.kind, message: input.message,
    ...(input.kind === 'prompt' && typeof input.defaultValue === 'string' ? { defaultValue: input.defaultValue } : {}),
  };
}
