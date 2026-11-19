import { maxDesignScriptBytes, parseDesignScriptName, parseDesignScriptSource } from '../../contracts/design-content-source.js';
import type { ImportDesignScriptInput } from '../../contracts/index.js';

export type DesignScriptSource = Pick<ImportDesignScriptInput, 'name' | 'source'>;

export async function readDesignScriptFile(file: File): Promise<DesignScriptSource> {
  const name = parseDesignScriptName(file.name);
  if (!file.size || file.size > maxDesignScriptBytes) throw new Error('Invalid script size.');
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
  return { name, source: parseDesignScriptSource(source) };
}

export function designScriptDirectory(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
}
