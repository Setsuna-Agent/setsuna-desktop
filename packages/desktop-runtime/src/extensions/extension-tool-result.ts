import {
  PLUGIN_UI_CARD_RESULT_KIND,
  normalizePluginUiCardToolData,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import { Script } from 'node:vm';
import type { ToolExecutionResult } from '../ports/tool-host.js';
import { assertSafeRuntimeId } from '../security/runtime-id.js';
import { protocolRecord } from './extension-worker-protocol.js';

export function normalizeExtensionToolResult(
  value: unknown,
  pluginId: string,
  allowUiCard: boolean,
  allowGeneratedAttachments = false,
): ToolExecutionResult {
  if (typeof value === 'string') return { content: value };
  const record = protocolRecord(value);
  if (!record) return { content: JSON.stringify(value ?? null) };
  const content = typeof record.content === 'string' ? record.content : JSON.stringify(value);
  const attachments = normalizeExtensionAttachments(record.attachments, allowGeneratedAttachments);
  const data = 'data' in record
    ? normalizePluginUiCardToolData(record.data, pluginId, allowUiCard)
    : undefined;
  assertPluginUiCardScriptSyntax(data, pluginId);
  return {
    content,
    ...(attachments ? { attachments } : {}),
    ...(typeof record.preview === 'string' ? { preview: record.preview } : {}),
    ...('data' in record ? { data } : {}),
    ...(record.containsExternalContext === true ? { containsExternalContext: true } : {}),
  };
}

function assertPluginUiCardScriptSyntax(value: unknown, pluginId: string): void {
  const envelope = protocolRecord(value);
  if (envelope?.resultKind !== PLUGIN_UI_CARD_RESULT_KIND) return;
  const payload = protocolRecord(envelope.payload);
  const source = payload?.js;
  if (typeof source !== 'string' || !source.trim()) return;
  try {
    new Script(source, {
      filename: `plugin-ui-card:${pluginId}/${typeof payload?.id === 'string' ? payload.id : 'unknown'}`,
    });
  } catch (error) {
    throw new Error(`Plugin UI card JavaScript is invalid: ${errorMessage(error)}`, { cause: error });
  }
}

function normalizeExtensionAttachments(
  value: unknown,
  allowed: boolean,
): RuntimeMessageAttachment[] | undefined {
  if (value === undefined) return undefined;
  if (!allowed) throw new Error('This extension is not allowed to return managed image attachments.');
  if (!Array.isArray(value) || value.length > 10) {
    throw new Error('Extension image attachments must be an array with at most 10 items.');
  }
  return value.map((item, index): RuntimeMessageAttachment => {
    const record = requiredRecord(item, `Extension image attachment ${index + 1} must be an object.`);
    if (record.source !== 'generated') {
      throw new Error(`Extension image attachment ${index + 1} must be a managed generated asset.`);
    }
    const size = record.size;
    if (!Number.isInteger(size) || (size as number) <= 0 || (size as number) > 20 * 1024 * 1024) {
      throw new Error(`Extension image attachment ${index + 1} has an invalid size.`);
    }
    return {
      id: boundedAttachmentText(record.id, `Extension image attachment ${index + 1} id`, 160),
      name: boundedAttachmentText(record.name, `Extension image attachment ${index + 1} name`, 255),
      type: boundedAttachmentText(record.type, `Extension image attachment ${index + 1} type`, 100),
      size: size as number,
      source: 'generated',
      assetId: assertSafeRuntimeId(
        boundedAttachmentText(record.assetId, `Extension image attachment ${index + 1} asset id`, 160),
        'Extension image asset id',
      ),
      modelVisible: false,
    };
  });
}

function boundedAttachmentText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label} is too long.`);
  return text;
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
  const record = protocolRecord(value);
  if (!record) throw new Error(message);
  return record;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
