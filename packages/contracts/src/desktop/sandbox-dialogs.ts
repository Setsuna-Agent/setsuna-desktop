export const SANDBOX_DIALOG_PATH = '/v1/sandbox-dialogs/';

export const SANDBOX_DIALOG_THEME_VARIABLES = [
  '--setsuna-color-text', '--setsuna-color-surface', '--setsuna-color-surface-muted',
  '--setsuna-color-border', '--setsuna-color-border-strong',
  '--setsuna-color-accent', '--setsuna-color-accent-hover', '--setsuna-color-accent-text',
  '--setsuna-font-family', '--setsuna-radius-control', '--setsuna-radius-field',
] as const;

export type SandboxDialogTheme = Readonly<{
  colorScheme: 'light' | 'dark';
  variables: Readonly<Partial<Record<typeof SANDBOX_DIALOG_THEME_VARIABLES[number], string>>>;
}>;

export type SandboxDialogSession = Readonly<{ id: string; url: string }>;
export type SandboxDialogRequest = Readonly<{
  kind: 'alert' | 'confirm' | 'prompt';
  message: string;
  defaultValue?: string;
  theme?: SandboxDialogTheme;
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
    ...(input.theme !== undefined ? { theme: parseDialogTheme(input.theme) } : {}),
  };
}

function parseDialogTheme(value: unknown): SandboxDialogTheme {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid dialog theme.');
  const input = value as Record<string, unknown>;
  if (input.colorScheme !== 'light' && input.colorScheme !== 'dark') throw new Error('Invalid dialog color scheme.');
  if (!input.variables || typeof input.variables !== 'object' || Array.isArray(input.variables)) {
    throw new Error('Invalid dialog theme variables.');
  }
  const variables: Partial<Record<typeof SANDBOX_DIALOG_THEME_VARIABLES[number], string>> = {};
  // Only presentation tokens cross the sandbox boundary; arbitrary CSS properties are never accepted.
  for (const name of SANDBOX_DIALOG_THEME_VARIABLES) {
    const token = (input.variables as Record<string, unknown>)[name];
    if (token === undefined) continue;
    if (typeof token !== 'string' || token.length > 512) throw new Error('Invalid dialog theme value.');
    variables[name] = token;
  }
  return { colorScheme: input.colorScheme, variables };
}
