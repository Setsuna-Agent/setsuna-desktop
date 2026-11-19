import type { DesignDocument, DesignEdit, DesignFrame, DesignScript, DesignScriptInputs, DesignScriptParameter, DesignScriptValue } from '../../contracts/index.js';
import { designScriptParameterValue } from '../../contracts/design-script-parameters.js';

export type DesignScriptResults = ReadonlyMap<string, DesignDocument>;
const scriptChildSegment = '/~script/';

export function isGeneratedScriptLayer(id: string): boolean {
  return id.includes(scriptChildSegment);
}

export function withDesignScriptInput(inputs: DesignScriptInputs | undefined, parameter: DesignScriptParameter, value: DesignScriptValue) {
  if (Object.is(designScriptParameterValue(parameter, inputs), value)) return inputs;
  const next = { ...inputs };
  if (Object.is(parameter.defaultValue, value)) delete next[parameter.name];
  else next[parameter.name] = value;
  return Object.keys(next).length ? next : undefined;
}

function scriptFrame({ scriptPath: _scriptPath, scriptInputs: _scriptInputs, ...node }: DesignScript, childIds: readonly string[]): DesignFrame {
  return { ...node, kind: 'frame', clip: true, childIds };
}

export function projectDesignScriptLayers(document: DesignDocument, results: DesignScriptResults): DesignDocument {
  if (!results.size) return document;
  const nodes = { ...document.nodes };
  for (const [id, result] of results) {
    const node = document.nodes[id];
    if (node?.kind !== 'script') continue;
    const childId = (key: string) => `${id}${scriptChildSegment}${key}`;
    nodes[id] = scriptFrame(node, result.rootIds.map(childId));
    for (const [key, child] of Object.entries(result.nodes)) {
      nodes[childId(key)] = child.kind === 'frame' ? { ...child, childIds: child.childIds.map(childId) } : child;
    }
  }
  return { ...document, nodes };
}

export function convertDesignScript(id: string, node: DesignScript, parentId: string | null, result: DesignDocument) {
  const frameId = crypto.randomUUID();
  const edits: DesignEdit[] = [
    { kind: 'insert', nodeId: frameId, parentId, node: scriptFrame(node, []) },
    { kind: 'reorder', nodeId: frameId, beforeId: id },
  ];
  function insert(key: string, parentId: string) {
    const child = result.nodes[key];
    const nodeId = crypto.randomUUID();
    edits.push({ kind: 'insert', nodeId, parentId, node: child.kind === 'frame' ? { ...child, childIds: [] } : child });
    if (child.kind === 'frame') child.childIds.forEach((key) => insert(key, nodeId));
  }
  result.rootIds.forEach((key) => insert(key, frameId));
  edits.push({ kind: 'remove', nodeId: id });
  return { frameId, edits };
}
