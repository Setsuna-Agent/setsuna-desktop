import { parseDesignScriptParameters } from '../contracts/design-script-parameters.js';

export function readScriptParameters(source: string) {
  const header = /^\s*\/\*\*([\s\S]*?)\*\//u.exec(source)?.[1];
  const declarations = header?.split(/\r\n?|\n/u).flatMap((raw) => {
    const line = raw.trim().replace(/^\*\s*/u, '');
    if (!/^@input(?:\s|$)/u.test(line)) return [];
    const match = /^@input\s+([^:\s]+)\s*:\s*([a-z]+)\s*=\s*(.+)$/u.exec(line);
    if (!match) throw new Error('Invalid script input declaration.');
    const [, name, type, literal] = match;
    // Defaults are data inside the source comment. Reading the inspector never executes the script.
    const defaultValue: unknown = type === 'color' && literal.startsWith('#') ? literal : JSON.parse(literal);
    return [{ name, type, defaultValue }];
  });
  return parseDesignScriptParameters(declarations ?? []);
}
