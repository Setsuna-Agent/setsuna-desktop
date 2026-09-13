/** Portable setup metadata. Commands are instructions for the user, never autorun probes. */
export type RuntimePluginConnector = {
  id: string;
  name: string;
  description?: string;
  required: boolean;
  documentationUrl?: string;
} & (
  | { kind: 'cli'; command: string; installUrl: string; setupCommands: string[] }
  | { kind: 'mcp'; serverKey: string }
);

export type RuntimePluginConnectorStatus = {
  connectorId: string;
  /** installed means CLI found; configured means MCP configured. Neither asserts authentication works. */
  state: 'missing' | 'installed' | 'configured' | 'needs-auth' | 'disabled' | 'error';
};

export function parseRuntimePluginConnectors(value: unknown): RuntimePluginConnector[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) throw new Error('Plugin connectors must be an array of at most 32 entries.');
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid plugin connector.');
    const record = item as Record<string, unknown>;
    const id = text(record.id, 'id');
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id) || ids.has(id)) throw new Error('Invalid or duplicate connector id.');
    ids.add(id);
    if (record.required !== undefined && typeof record.required !== 'boolean') throw new Error('Connector required must be boolean.');
    const common = {
      id,
      name: text(record.name, 'name'),
      required: record.required !== false,
      ...(record.description === undefined ? {} : { description: text(record.description, 'description') }),
      ...(record.documentationUrl === undefined ? {} : { documentationUrl: url(record.documentationUrl) }),
    };
    if (record.kind === 'mcp') return { ...common, kind: 'mcp', serverKey: text(record.serverKey, 'serverKey') };
    if (record.kind !== 'cli') throw new Error('Connector kind must be cli or mcp.');
    const command = text(record.command, 'command');
    // A portable executable name, not a machine-specific path or shell expression.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(command)) throw new Error('Connector command must be an executable name.');
    const commands = record.setupCommands ?? [];
    if (!Array.isArray(commands) || commands.length > 8) throw new Error('Invalid connector setupCommands.');
    return { ...common, kind: 'cli', command, installUrl: url(record.installUrl), setupCommands: commands.map((item) => text(item, 'setup command')) };
  });
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048
    || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error(`Invalid connector ${label}.`);
  }
  return value.trim();
}

function url(value: unknown): string {
  const result = text(value, 'URL');
  const parsed = new URL(result);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Connector links must use HTTPS without credentials.');
  return result;
}
