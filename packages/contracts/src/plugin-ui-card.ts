import {
  parseRuntimePluginUiData,
  type RuntimePluginUiData,
} from './plugin-ui.js';

export const PLUGIN_UI_CARD_RESULT_KIND = 'plugin.ui-card' as const;
export const PLUGIN_UI_CARD_RESULT_MAJOR = 1 as const;

export const PLUGIN_UI_CARD_DECLARATION_LIMITS = Object.freeze({
  entries: 16,
  descriptionCharacters: 500,
  labelCharacters: 200,
});

export const PLUGIN_UI_CARD_LIMITS = Object.freeze({
  cssBytes: 128 * 1024,
  htmlBytes: 192 * 1024,
  jsBytes: 256 * 1024,
  sourceBytes: 512 * 1024,
  titleCharacters: 200,
});

export type RuntimeSandboxedUiSource = Readonly<{
  html: string;
  css: string;
  js: string;
}>;

export type RuntimePluginUiCard = Readonly<{
  id: string;
  pluginId: string;
  title?: string;
  html: string;
  css: string;
  js: string;
  data: RuntimePluginUiData;
  permissions: Readonly<{
    network: false;
    hostActions: readonly string[];
  }>;
}>;

export type RuntimePluginUiCardPreview = Readonly<RuntimeSandboxedUiSource & {
  /** Static example data used only in the Plugin details preview. */
  data: RuntimePluginUiData;
}>;

/** Install-time catalog metadata and a side-effect-free preview for a dynamic card. */
export type RuntimePluginUiCardDeclaration = Readonly<{
  id: string;
  label: string;
  description?: string;
  toolName: string;
  preview: RuntimePluginUiCardPreview;
}>;

export function parseRuntimePluginUiCardDeclarations(
  value: unknown,
): readonly RuntimePluginUiCardDeclaration[] {
  if (!Array.isArray(value) || value.length > PLUGIN_UI_CARD_DECLARATION_LIMITS.entries) {
    throw new Error(
      `Plugin extension uiCards must be an array with at most ${PLUGIN_UI_CARD_DECLARATION_LIMITS.entries} entries.`,
    );
  }
  const ids = new Set<string>();
  const declarations = value.map((item, index) => {
    const card = exactRecord(
      item,
      ['id', 'label', 'description', 'toolName', 'preview'],
      `Plugin extension uiCards[${index}] must be an object.`,
    );
    const id = identity(card.id, `Plugin extension uiCards[${index}].id`);
    if (ids.has(id)) throw new Error(`Duplicate Plugin extension UI card: ${id}.`);
    ids.add(id);
    const label = requiredText(
      card.label,
      `Plugin extension uiCards[${index}].label`,
      PLUGIN_UI_CARD_DECLARATION_LIMITS.labelCharacters,
    );
    const description = optionalText(
      card.description,
      `Plugin extension uiCards[${index}].description`,
      PLUGIN_UI_CARD_DECLARATION_LIMITS.descriptionCharacters,
    );
    const toolName = identity(card.toolName, `Plugin extension uiCards[${index}].toolName`);
    const preview = parsePluginUiCardPreview(card.preview, index);
    return Object.freeze({ id, label, ...(description ? { description } : {}), toolName, preview });
  });
  return Object.freeze(declarations);
}

function parsePluginUiCardPreview(value: unknown, index: number): RuntimePluginUiCardPreview {
  const label = `Plugin extension uiCards[${index}].preview`;
  const preview = exactRecord(value, ['html', 'css', 'js', 'data'], `${label} must be an object.`);
  const source = parseSandboxedUiSource(preview, label);
  if (!source.html.trim() && !source.js.trim()) {
    throw new Error(`${label} must contain HTML or JavaScript.`);
  }
  return Object.freeze({
    ...source,
    data: parseRuntimePluginUiData(preview.data ?? {}),
  });
}

export function parseRuntimePluginUiCard(value: unknown): RuntimePluginUiCard {
  const card = exactRecord(
    value,
    ['id', 'pluginId', 'title', 'html', 'css', 'js', 'data', 'permissions'],
    'Plugin UI card must be an object.',
  );
  const id = identity(card.id, 'Plugin UI card id');
  const pluginId = identity(card.pluginId, 'Plugin UI card pluginId');
  const title = optionalText(card.title, 'Plugin UI card title', PLUGIN_UI_CARD_LIMITS.titleCharacters);
  const source = parseSandboxedUiSource(card, 'Plugin UI card');
  const data = parseRuntimePluginUiData(card.data ?? {});
  const permissions = parseCardPermissions(card.permissions);
  return Object.freeze({
    id,
    pluginId,
    ...(title ? { title } : {}),
    ...source,
    data,
    permissions,
  });
}

export function parseSandboxedUiSource(
  value: unknown,
  label = 'Sandboxed UI source',
): RuntimeSandboxedUiSource {
  const source = objectRecord(value, `${label} must be an object.`);
  const html = boundedSource(source.html ?? '', `${label} html`, PLUGIN_UI_CARD_LIMITS.htmlBytes);
  const css = boundedSource(source.css ?? '', `${label} css`, PLUGIN_UI_CARD_LIMITS.cssBytes);
  const js = boundedSource(source.js ?? '', `${label} js`, PLUGIN_UI_CARD_LIMITS.jsBytes);
  const bytes = utf8Bytes(html) + utf8Bytes(css) + utf8Bytes(js);
  if (bytes > PLUGIN_UI_CARD_LIMITS.sourceBytes) throw new Error(`${label} is too large.`);
  return Object.freeze({ html, css, js });
}

export function pluginUiCardResultEnvelope(payload: RuntimePluginUiCard): Readonly<{
  resultKind: typeof PLUGIN_UI_CARD_RESULT_KIND;
  resultMajor: typeof PLUGIN_UI_CARD_RESULT_MAJOR;
  payload: RuntimePluginUiCard;
}> {
  return Object.freeze({
    resultKind: PLUGIN_UI_CARD_RESULT_KIND,
    resultMajor: PLUGIN_UI_CARD_RESULT_MAJOR,
    payload: parseRuntimePluginUiCard(payload),
  });
}

/**
 * Extension workers cannot choose their persisted Plugin provenance. The host
 * stamps the verified owner onto card data before it crosses into thread state.
 */
export function normalizePluginUiCardToolData(
  value: unknown,
  pluginId: string,
  uiCapability = true,
): unknown {
  const envelope = objectRecordOrNull(value);
  if (envelope?.resultKind !== PLUGIN_UI_CARD_RESULT_KIND) return value;
  if (!uiCapability) throw new Error('Plugin UI cards require the ui capability.');
  if (envelope.resultMajor !== PLUGIN_UI_CARD_RESULT_MAJOR) {
    throw new Error(`Plugin UI card resultMajor must be ${PLUGIN_UI_CARD_RESULT_MAJOR}.`);
  }
  const rawPayload = objectRecord(envelope.payload, 'Plugin UI card payload must be an object.');
  if (rawPayload.pluginId !== undefined && rawPayload.pluginId !== pluginId) {
    throw new Error('Plugin UI card cannot claim another Plugin owner.');
  }
  return pluginUiCardResultEnvelope(parseRuntimePluginUiCard({ ...rawPayload, pluginId }));
}

function parseCardPermissions(value: unknown): RuntimePluginUiCard['permissions'] {
  if (value === undefined) return Object.freeze({ network: false, hostActions: Object.freeze([]) });
  const permissions = exactRecord(
    value,
    ['network', 'hostActions'],
    'Plugin UI card permissions must be an object.',
  );
  if (permissions.network !== false) throw new Error('Plugin UI cards cannot access the network directly.');
  if (!Array.isArray(permissions.hostActions) || permissions.hostActions.length > 0) {
    throw new Error('Plugin UI card hostActions are not enabled in this schema version.');
  }
  return Object.freeze({ network: false, hostActions: Object.freeze([]) });
}

function boundedSource(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || utf8Bytes(value) > maxBytes) throw new Error(`${label} is too large.`);
  return value;
}

function identity(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length > 128
    || !/^[a-z0-9][a-z0-9._:-]*$/u.test(value)
  ) throw new Error(`${label} is invalid.`);
  return value;
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} is invalid.`);
  return value.trim();
}

function requiredText(value: unknown, label: string, max: number): string {
  const normalized = optionalText(value, label, max);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function exactRecord(value: unknown, keys: readonly string[], message: string): Record<string, unknown> {
  const record = objectRecord(value, message);
  const allowed = new Set(keys);
  const unsupported = Object.keys(record).find((key) => !allowed.has(key));
  if (unsupported) throw new Error(`${message} Unsupported property: ${unsupported}.`);
  return record;
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  const record = objectRecordOrNull(value);
  if (!record) throw new Error(message);
  return record;
}

function objectRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
