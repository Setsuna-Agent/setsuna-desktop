import { safeRelativePath } from './file-plugin-bundle-paths.js';
import { objectRecord, optionalString, stringArray } from './file-plugin-bundle-values.js';

const SUPPORTED_FIELDS = new Set([
  'type', 'transport', 'command', 'args', 'cwd', 'url', 'label', 'description', 'enabled',
  'bearer_token_env_var', 'bearerTokenEnvVar',
  'timeout_ms', 'timeoutMs', 'startup_timeout_ms', 'startupTimeoutMs', 'tool_timeout_ms', 'toolTimeoutMs',
  'allowed_tools', 'allowedTools', 'disabled_tools', 'disabledTools',
  'oauth_client_id', 'oauthClientId', 'oauth_resource', 'oauthResource',
]);

/** Convert declarations only. Secrets are configured separately in the MCP settings. */
export function convertCodexMcpServers(value: unknown): Record<string, unknown>[] {
  const servers = objectRecord(value, 'Codex plugin mcpServers must be an object.');
  return Object.entries(servers).map(([key, value]) => {
    const server = { ...objectRecord(value, `Codex MCP server ${key} must be an object.`) };
    normalizeCodexMcpOptions(key, server);
    for (const field of ['env', 'headers', 'envHttpHeaders', 'env_http_headers']) {
      if (server[field] === undefined) continue;
      const entries = objectRecord(server[field], `Codex MCP ${field} must be an object.`);
      if (Object.keys(entries).length) {
        throw new Error(`Codex MCP server ${key}: bundled ${field} is not supported. Configure credentials in MCP settings.`);
      }
      delete server[field];
    }
    const unsupported = Object.keys(server).filter((field) => !SUPPORTED_FIELDS.has(field));
    if (unsupported.length) throw new Error(`Codex MCP server ${key} has unsupported fields: ${unsupported.join(', ')}.`);
    const transport = server.type ?? server.transport ?? (server.command ? 'stdio' : 'http');
    if (!['stdio', 'http', 'streamable-http', 'streamable_http', 'streamableHttp'].includes(String(transport))) {
      throw new Error(`Codex MCP server ${key} uses an unsupported transport.`);
    }
    const { type: _type, ...fields } = server;
    if (transport !== 'stdio') return { ...fields, key, transport };
    return {
      ...fields,
      key,
      transport,
      command: pluginRootValue(optionalString(server.command)),
      args: stringArray(server.args, `Codex MCP server ${key}.args`).map((arg) => pluginRootValue(arg)),
      cwd: bundleWorkingDirectory(optionalString(server.cwd)),
    };
  });
}

function normalizeCodexMcpOptions(key: string, server: Record<string, unknown>): void {
  // Presentation fields do not alter transport behavior or grant capabilities.
  server.label ??= optionalString(server.title);
  server.description ??= optionalString(server.note);
  delete server.title;
  delete server.note;
  delete server.icons;
  for (const [seconds, milliseconds] of [
    ['startup_timeout_sec', 'startupTimeoutMs'], ['tool_timeout_sec', 'toolTimeoutMs'],
  ]) {
    if (server[seconds] === undefined) continue;
    const timeout = server[seconds];
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
      throw new Error(`Codex MCP server ${key}.${seconds} must be a positive number.`);
    }
    server[milliseconds] ??= Math.ceil(timeout * 1_000);
    delete server[seconds];
  }
  if (server.oauth === undefined) return;
  const oauth = objectRecord(server.oauth, `Codex MCP server ${key}.oauth must be an object.`);
  const unsupported = Object.keys(oauth).filter((field) => !['client_id', 'resource'].includes(field));
  if (unsupported.length) {
    throw new Error(`Codex MCP server ${key} requires unsupported OAuth options: ${unsupported.join(', ')}. Bundled OAuth secrets and host-specific callbacks cannot be imported.`);
  }
  const clientId = optionalString(oauth.client_id);
  if (clientId && /^<.+>$/u.test(clientId)) {
    throw new Error(`Codex MCP server ${key} contains an OAuth client ID placeholder. A registered client ID must be configured before importing this bundle.`);
  }
  server.oauthClientId ??= clientId;
  server.oauthResource ??= optionalString(oauth.resource);
  delete server.oauth;
}

function bundleWorkingDirectory(value: string | undefined): string {
  const converted = pluginRootValue(value ?? '${CODEX_PLUGIN_ROOT}')!;
  if (converted.startsWith('{{pluginRoot}}')) return converted;
  return `{{pluginRoot}}/${safeRelativePath(converted, 'Codex MCP working directory')}`;
}

function pluginRootValue(value: string | undefined): string | undefined {
  if (!value) return value;
  const converted = value.replaceAll('${CODEX_PLUGIN_ROOT}', '{{pluginRoot}}');
  if (converted.includes('${')) throw new Error('Codex MCP supports only the CODEX_PLUGIN_ROOT path variable.');
  // Each stdio argument is one value, so spaces remain part of its path.
  for (const suffix of converted.split('{{pluginRoot}}').slice(1)) {
    if (suffix && !/^[\\/]/u.test(suffix)) throw new Error('Codex MCP plugin root must be followed by a relative path.');
    if (suffix) safeRelativePath(suffix.slice(1), 'Codex MCP plugin root path');
  }
  return converted;
}
