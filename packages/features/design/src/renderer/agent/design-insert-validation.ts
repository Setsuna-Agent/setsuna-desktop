import { maxDesignFills, maxDesignStrokes, parseDesignLayout } from '../../contracts/document.js';
import { designLayoutDefaults } from '../context/design-layer-commands.js';
import { defaultDesignStroke } from '../design-paint.js';

export type LayerIssue = { path: string; message: string; layer?: string; suggestedValue?: unknown };
type Fields = Record<string, unknown>;

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function layoutIssues(input: unknown, path: string): LayerIssue[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const fields = input as Fields;
  const defaults = designLayoutDefaults;
  const issues: LayerIssue[] = [];
  for (const key of new Set([...Object.keys(defaults), ...Object.keys(fields)])) {
    try {
      const layout = parseDesignLayout({ ...defaults, [key]: fields[key] });
      if (!Object.hasOwn(layout, key)) throw new Error('Unknown layout field.');
    } catch (error) {
      const suggestedValue = fields[key] === undefined ? defaults[key as keyof typeof defaults] : undefined;
      issues.push({ path: path + '.' + key, message: errorMessage(error), suggestedValue });
    }
  }
  return issues;
}

function paintIssues(key: 'fills' | 'strokes', value: unknown, path: string, validate: (stack: unknown[]) => void): LayerIssue[] {
  if (!Array.isArray(value) || value.length > (key === 'fills' ? maxDesignFills : maxDesignStrokes)) return [];
  const issues: LayerIssue[] = [];
  const defaults: Fields = key === 'fills' ? { color: defaultDesignStroke.color } : defaultDesignStroke;
  value.forEach((paint: unknown, index: number) => {
    const entry = path + '[' + index + ']';
    try { validate([paint]); return; }
    catch (error) {
      if (!paint || typeof paint !== 'object' || Array.isArray(paint)) {
        issues.push({ path: entry, message: errorMessage(error) });
        return;
      }
    }
    const fields = paint as Fields;
    const scratch = { ...defaults };
    for (const field of new Set([...Object.keys(defaults), ...Object.keys(fields)])) {
      try {
        validate([{ ...scratch, [field]: fields[field] }]);
        scratch[field] = fields[field];
      } catch (error) { issues.push({ path: entry + '.' + field, message: errorMessage(error) }); }
    }
  });
  return issues;
}

// Only run after the real decoder rejects a layer. Replay independent fields against its
// drawing defaults so one bad enum cannot hide another. Scratch values never enter an edit.
export function diagnoseInsertFields(fields: Fields, path: string, validate: (fields: Fields) => unknown): LayerIssue[] {
  const scratch: Fields = { kind: fields.kind };
  const required = fields.kind === 'image' ? { assetPath: 'image.png' } : fields.kind === 'vector' ? { geometry: { kind: 'polygon', sides: 3 } } : {};
  Object.assign(scratch, required);
  try { validate(scratch); } catch (error) { return [{ path: path + '.kind', message: errorMessage(error) }]; }

  const issues: LayerIssue[] = [];
  // Establish prerequisites before their dependents (text runs, overrides, geometry bindings).
  const keys = new Set([...Object.keys(required), ...['text', 'instanceOf', 'geometry'].filter((key) => Object.hasOwn(fields, key)), ...Object.keys(fields)]);
  for (const key of keys) {
    if (key === 'kind') continue;
    const candidate = { ...scratch, [key]: fields[key] };
    try {
      validate(candidate);
      Object.assign(scratch, { [key]: fields[key] });
    } catch (error) {
      const fieldPath = path + '.' + key;
      let nested: LayerIssue[] = [];
      if (key === 'layout' && fields.kind === 'frame') nested = layoutIssues(fields.layout, fieldPath);
      if (key === 'strokes' || (key === 'fills' && fields.kind !== 'image')) {
        nested = paintIssues(key, fields[key], fieldPath, (stack) => validate({ ...scratch, [key]: stack }));
      }
      issues.push(...(nested.length ? nested : [{ path: fieldPath, message: errorMessage(error) }]));
    }
  }
  return issues;
}
