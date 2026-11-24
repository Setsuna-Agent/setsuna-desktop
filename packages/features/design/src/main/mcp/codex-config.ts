import { getStaticTOMLValue, parseTOML, type AST } from 'toml-eslint-parser';
import { designMcpName, type DesignMcpStdio } from './client-config.js';

const serverPath = ['mcp_servers', designMcpName];

export function editCodexConfig(source: string, config: DesignMcpStdio, enabled: boolean, canEdit: (previous: unknown) => boolean): string {
  let ast: AST.TOMLProgram;
  try {
    ast = parseTOML(source, { tomlVersion: '1.0' });
  } catch {
    throw new Error('Codex user configuration is invalid TOML.');
  }
  const servers = getStaticTOMLValue(ast).mcp_servers as Record<string, unknown> | undefined;
  const previous = servers?.[designMcpName];
  if (!canEdit(previous)) return source;

  const { entry, inline } = locateServer(ast);
  const fields = [`command = ${tomlString(config.command)}`, `args = [${config.args.map(tomlString).join(', ')}]`,
    'env = { ELECTRON_RUN_AS_NODE = "1" }'];
  const literal = `{ ${fields.join(', ')} }`;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let next: string;
  if (entry) {
    if (entry.type === 'TOMLTable') {
      // Update just the launch fields so Codex tool settings and comments survive relocation.
      next = enabled ? updateTable(source, entry, config) : removeServerTables(source, ast);
    } else if (enabled) {
      next = updateInlineEntry(source, entry, config);
    } else {
      next = replace(source, entry.parent.type === 'TOMLInlineTable' ? inlineRemovalRange(entry, entry.parent) : entry.range, '');
    }
  } else if (previous !== undefined) {
    throw new Error('The Setsuna Design MCP entry uses an unsupported Codex configuration layout.');
  } else if (inline) {
    const last = inline.body.at(-1);
    const end = last?.range[1] ?? inline.range[0] + 1;
    next = replace(source, [end, end], `${last ? ', ' : ' '}${designMcpName} = ${literal}${last ? '' : ' '}`);
  } else {
    next = [source, `[${serverPath.join('.')}]`, ...fields, ''].join(newline);
  }
  // An existing inline or dotted table can constrain how a new table is declared.
  try {
    parseTOML(next, { tomlVersion: '1.0' });
  } catch {
    throw new Error('Setsuna Design could not be added to the existing Codex configuration.');
  }
  return next;
}

function hasKey(key: readonly (string | number)[], expected: readonly string[]): boolean {
  return key.length === expected.length && key.every((part, index) => part === expected[index]);
}

function locateServer(ast: AST.TOMLProgram): { entry?: AST.TOMLTable | AST.TOMLKeyValue; inline?: AST.TOMLInlineTable } {
  for (const item of ast.body[0].body) {
    if (item.type === 'TOMLTable') {
      if (hasKey(item.resolvedKey, serverPath)) return { entry: item };
      if (hasKey(item.resolvedKey, ['mcp_servers'])) {
        const entry = item.body.find(({ key }) => hasKey(getStaticTOMLValue(key), [designMcpName]));
        if (entry) return { entry };
      }
      continue;
    }
    const key = getStaticTOMLValue(item.key);
    if (hasKey(key, serverPath)) return { entry: item };
    if (hasKey(key, ['mcp_servers']) && item.value.type === 'TOMLInlineTable') {
      return { inline: item.value, entry: item.value.body.find(({ key }) => hasKey(getStaticTOMLValue(key), [designMcpName])) };
    }
  }
  return {};
}

function updateTable(source: string, table: AST.TOMLTable | AST.TOMLInlineTable, config: DesignMcpStdio): string {
  const updates = { command: tomlString(config.command), args: `[${config.args.map(tomlString).join(', ')}]` };
  let next = source;
  // Ownership requires these fields to exist. Work backward so the AST offsets remain valid.
  for (const { key, value } of [...table.body].reverse()) {
    const [name, ...rest] = getStaticTOMLValue(key);
    if (!rest.length && (name === 'command' || name === 'args')) next = replace(next, value.range, updates[name]);
  }
  return next;
}

function updateInlineEntry(source: string, entry: AST.TOMLKeyValue, config: DesignMcpStdio): string {
  if (entry.value.type !== 'TOMLInlineTable') throw new Error('Setsuna Design MCP is not an inline table.');
  return updateTable(source, entry.value, config);
}

function removeServerTables(source: string, ast: AST.TOMLProgram): string {
  let next = source;
  for (const item of [...ast.body[0].body].reverse()) {
    if (item.type === 'TOMLTable' && hasKey(item.resolvedKey.slice(0, serverPath.length), serverPath)) {
      next = replace(next, item.range, '');
    }
  }
  return next;
}

function inlineRemovalRange(entry: AST.TOMLKeyValue, parent: AST.TOMLInlineTable): AST.Range {
  const index = parent.body.indexOf(entry);
  const next = parent.body[index + 1];
  const previous = parent.body[index - 1];
  if (next) return [entry.range[0], next.range[0]];
  if (previous) return [previous.range[1], entry.range[1]];
  return entry.range;
}

function replace(source: string, [start, end]: AST.Range, value: string): string {
  return source.slice(0, start) + value + source.slice(end);
}

function tomlString(value: string): string {
  return JSON.stringify(value).replace(/\u007f/gu, '\\u007f');
}
