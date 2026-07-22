import type {
  RuntimeMcpRequireApproval,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpToolInfo,
  RuntimeMcpTransport,
  RuntimeMcpTrustLevel,
} from '@setsuna-desktop/contracts';
import { translate, type Translate } from '../../../shared/i18n/I18nProvider.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

export type McpDraft = {
  key: string;
  label: string;
  description: string;
  transport: RuntimeMcpTransport;
  command: string;
  args: string;
  cwd: string;
  url: string;
  env: string;
  headers: string;
  envHttpHeaders: string;
  bearerTokenEnvVar: string;
  oauthClientId: string;
  oauthResource: string;
  enabled: boolean;
  required: boolean;
  requireApproval: RuntimeMcpRequireApproval;
  trustLevel: RuntimeMcpTrustLevel;
  timeoutMs: string;
  startupTimeoutMs: string;
  toolTimeoutMs: string;
  allowedTools: string;
  disabledTools: string;
  tools: RuntimeMcpToolInfo[];
};

export const emptyMcpDraft: McpDraft = {
  key: '',
  label: '',
  description: '',
  transport: 'stdio',
  command: '',
  args: '',
  cwd: '',
  url: '',
  env: '',
  headers: '',
  envHttpHeaders: '',
  bearerTokenEnvVar: '',
  oauthClientId: '',
  oauthResource: '',
  enabled: true,
  required: false,
  requireApproval: 'auto',
  trustLevel: 'untrusted',
  timeoutMs: '',
  startupTimeoutMs: '',
  toolTimeoutMs: '',
  allowedTools: '',
  disabledTools: '',
  tools: [],
};

export function mcpDraftToInput(
  draft: McpDraft,
  key: string,
  existing?: RuntimeMcpServer | null,
  t: Translate = defaultTranslate,
): RuntimeMcpServerInput {
  return {
    key,
    label: draft.label.trim() || key,
    description: optionalText(draft.description),
    transport: draft.transport,
    requireApproval: draft.requireApproval,
    trustLevel: draft.trustLevel,
    enabled: draft.enabled,
    required: draft.required,
    timeoutMs: optionalNumber(draft.timeoutMs),
    startupTimeoutMs: optionalNumber(draft.startupTimeoutMs),
    toolTimeoutMs: optionalNumber(draft.toolTimeoutMs),
    allowedTools: splitList(draft.allowedTools, t),
    disabledTools: splitList(draft.disabledTools, t),
    tools: draft.tools,
    ...(draft.transport === 'stdio'
      ? {
          command: draft.command.trim(),
          args: splitList(draft.args, t),
          cwd: optionalText(draft.cwd),
          ...(!existing || draft.env.trim() ? { env: keyValueLines(draft.env) } : {}),
        }
      : {
          url: draft.url.trim(),
          ...(!existing || draft.headers.trim() ? { headers: keyValueLines(draft.headers) } : {}),
          ...(draft.envHttpHeaders.trim() ? { envHttpHeaders: keyValueLines(draft.envHttpHeaders) } : {}),
          ...(draft.bearerTokenEnvVar.trim() ? { bearerTokenEnvVar: draft.bearerTokenEnvVar.trim() } : {}),
          ...(draft.oauthClientId.trim() ? { oauthClientId: draft.oauthClientId.trim() } : {}),
          ...(draft.oauthResource.trim() ? { oauthResource: draft.oauthResource.trim() } : {}),
        }),
  };
}

export function splitList(value: string, t: Translate = defaultTranslate): string[] {
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error(t('capabilities.mcp.invalidArgs'));
    return parsed.map((item) => String(item));
  }
  return text.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

export function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined;
}

export function mcpToolStats(tools: RuntimeMcpToolInfo[], allowedTools: string[], disabledTools: string[]): { enabled: number; total: number } {
  const allowed = new Set(allowedTools);
  const disabled = new Set(disabledTools);
  return {
    total: tools.length,
    enabled: tools.filter((tool) => (!allowed.size || allowed.has(tool.name)) && !disabled.has(tool.name)).length,
  };
}

export function mcpAuthStatusLabel(status: RuntimeMcpServer['authStatus'], t: Translate = defaultTranslate): string {
  switch (status) {
    case 'bearerToken':
      return 'Bearer Token';
    case 'oAuth':
      return t('capabilities.mcp.auth.oauthReady');
    case 'oAuthLoggingIn':
      return t('capabilities.mcp.auth.oauthLoggingIn');
    case 'oAuthExpired':
      return t('capabilities.mcp.auth.oauthExpired');
    case 'oAuthError':
      return t('capabilities.mcp.auth.oauthError');
    case 'notLoggedIn':
      return t('capabilities.mcp.auth.notLoggedIn');
    case 'unsupported':
    default:
      return t('capabilities.mcp.auth.notRequired');
  }
}

export function keyValueLines(value: string): Record<string, string> | undefined {
  const entries = value
    .split('\n')
    .map((line) => {
      const index = line.indexOf('=');
      if (index === -1) return null;
      const key = line.slice(0, index).trim();
      const entryValue = line.slice(index + 1).trim();
      return key && entryValue ? ([key, entryValue] as const) : null;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));
  return entries.length ? Object.fromEntries(entries) : undefined;
}
