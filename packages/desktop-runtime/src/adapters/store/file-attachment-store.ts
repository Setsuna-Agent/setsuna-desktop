import {
  RUNTIME_FILE_ATTACHMENT_MAX_BYTES,
  isRuntimeStoredMessageAttachment,
  type RuntimeAttachmentUploadInput,
  type RuntimeFileAttachmentMimeType,
  type RuntimeMessageAttachment,
  type RuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  RuntimeAttachmentValidationError,
  type AttachmentStore,
  type RuntimeResolvedAttachment,
} from '../../ports/attachment-store.js';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import { assertSafeRuntimeId } from '../../security/runtime-id.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

type StoredAttachmentRecord = {
  id: string;
  name: string;
  type: RuntimeFileAttachmentMimeType;
  size: number;
  fileName: string;
  createdAt: string;
  threadIds: string[];
};

type AttachmentIndex = {
  version: 1;
  attachments: StoredAttachmentRecord[];
};

const EMPTY_INDEX: AttachmentIndex = { version: 1, attachments: [] };
const DEFAULT_PENDING_TTL_MS = 24 * 60 * 60 * 1_000;
const PDF_MIME_TYPE: RuntimeFileAttachmentMimeType = 'application/pdf';
const DOCX_MIME_TYPE: RuntimeFileAttachmentMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** 在工作区外持久化用户上传的文档，并通过不透明资源 ID 授予访问权限。 */
export class FileAttachmentStore implements AttachmentStore {
  private readonly root: string;
  private readonly filesRoot: string;
  private readonly indexPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly pendingTtlMs = DEFAULT_PENDING_TTL_MS,
  ) {
    this.root = path.join(dataDir, 'attachments');
    this.filesRoot = path.join(this.root, 'files');
    this.indexPath = path.join(this.root, 'index.json');
  }

  async recover(validThreadIds: string[]): Promise<void> {
    const validThreads = new Set(validThreadIds.map((id) => assertSafeRuntimeId(id, 'Thread id')));
    await this.enqueueMutation(async () => {
      await mkdir(this.filesRoot, { recursive: true });
      const index = await this.readIndex();
      const now = this.clock.now().getTime();
      const retained: StoredAttachmentRecord[] = [];
      const removedIds = new Set<string>();

      for (const record of index.attachments) {
        const threadIds = record.threadIds.filter((threadId) => validThreads.has(threadId));
        const createdAt = Date.parse(record.createdAt);
        const pendingExpired = !threadIds.length && (!Number.isFinite(createdAt) || now - createdAt >= this.pendingTtlMs);
        const fileExists = await stat(this.filePath(record)).then((entry) => entry.isFile()).catch(() => false);
        if (pendingExpired || !fileExists) {
          removedIds.add(record.id);
          continue;
        }
        retained.push({ ...record, threadIds });
      }

      await this.writeIndex({ version: 1, attachments: retained });
      const retainedIds = new Set(retained.map((record) => record.id));
      const directories = await readdir(this.filesRoot, { withFileTypes: true });
      const orphanDirectories: string[] = [];
      for (const entry of directories) {
        if (!entry.isDirectory() || retainedIds.has(entry.name)) continue;
        orphanDirectories.push(entry.name);
      }
      await Promise.all([
        ...[...removedIds].map((id) => this.removeAssetDirectory(id)),
        ...orphanDirectories.map((name) => this.removeDiscoveredAssetDirectory(name)),
      ]);
    });
  }

  create(input: RuntimeAttachmentUploadInput): Promise<RuntimeStoredMessageAttachment> {
    return this.enqueueMutation(async () => {
      const validated = validateUpload(input);
      const id = assertSafeRuntimeId(this.ids.id('attachment'), 'Attachment id');
      const record: StoredAttachmentRecord = {
        id,
        name: validated.name,
        type: validated.type,
        size: validated.data.byteLength,
        fileName: safeStoredFileName(validated.name, validated.type),
        createdAt: this.clock.now().toISOString(),
        threadIds: [],
      };
      const index = await this.readIndex();
      const assetDirectory = this.assetDirectory(id);
      await mkdir(this.filesRoot, { recursive: true });
      await mkdir(assetDirectory, { recursive: false });
      try {
        // 插件只需读取源文件；将受管理副本保持为不可写，可防止意外原地修改。
        await writeFile(this.filePath(record), validated.data, { flag: 'wx', mode: 0o400 });
        await this.writeIndex({ version: 1, attachments: [...index.attachments, record] });
      } catch (error) {
        await rm(assetDirectory, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      return storedAttachment(record);
    });
  }

  deletePending(assetId: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      const safeId = assertSafeRuntimeId(assetId, 'Attachment id');
      const index = await this.readIndex();
      const record = index.attachments.find((item) => item.id === safeId);
      if (!record || record.threadIds.length) return false;
      await this.writeIndex({
        version: 1,
        attachments: index.attachments.filter((item) => item.id !== safeId),
      });
      await this.removeAssetDirectory(safeId);
      return true;
    });
  }

  claimForThread(threadId: string, attachments: RuntimeMessageAttachment[]): Promise<RuntimeMessageAttachment[]> {
    return this.enqueueMutation(async () => {
      const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
      const storedAttachments = uniqueStoredAttachments(attachments);
      if (!storedAttachments.length) return attachments.map(cloneAttachment);
      const index = await this.readIndex();
      const recordsById = new Map(index.attachments.map((record) => [record.id, record]));

      for (const attachment of storedAttachments) {
        const record = requireMatchingRecord(recordsById, attachment);
        if (record.threadIds.length && !record.threadIds.includes(safeThreadId)) {
          throw new Error(`Attachment is already owned by another thread: ${attachment.name}`);
        }
        if (!record.threadIds.includes(safeThreadId)) record.threadIds.push(safeThreadId);
      }
      await this.writeIndex(index);
      return attachments.map(cloneAttachment);
    });
  }

  retainForThread(threadId: string, attachments: RuntimeMessageAttachment[]): Promise<void> {
    return this.enqueueMutation(async () => {
      const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
      const storedAttachments = uniqueStoredAttachments(attachments);
      if (!storedAttachments.length) return;
      const index = await this.readIndex();
      const recordsById = new Map(index.attachments.map((record) => [record.id, record]));
      for (const attachment of storedAttachments) {
        const record = requireMatchingRecord(recordsById, attachment);
        if (!record.threadIds.length) throw new Error(`Cannot retain an unclaimed attachment: ${attachment.name}`);
        if (!record.threadIds.includes(safeThreadId)) record.threadIds.push(safeThreadId);
      }
      await this.writeIndex(index);
    });
  }

  releaseThread(threadId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
      const index = await this.readIndex();
      const removedIds: string[] = [];
      const attachments = index.attachments.flatMap((record) => {
        if (!record.threadIds.includes(safeThreadId)) return [record];
        const threadIds = record.threadIds.filter((id) => id !== safeThreadId);
        if (threadIds.length) return [{ ...record, threadIds }];
        removedIds.push(record.id);
        return [];
      });
      await this.writeIndex({ version: 1, attachments });
      await Promise.all(removedIds.map((id) => this.removeAssetDirectory(id)));
    });
  }

  async resolveForThread(threadId: string, attachments: RuntimeMessageAttachment[]): Promise<RuntimeResolvedAttachment[]> {
    await this.mutationQueue;
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    const index = await this.readIndex();
    const recordsById = new Map(index.attachments.map((record) => [record.id, record]));
    const resolved: RuntimeResolvedAttachment[] = [];
    for (const attachment of uniqueStoredAttachments(attachments)) {
      const record = recordsById.get(attachment.assetId);
      if (!record || !record.threadIds.includes(safeThreadId) || !attachmentMatchesRecord(attachment, record)) continue;
      const absolutePath = this.filePath(record);
      const exists = await stat(absolutePath).then((entry) => entry.isFile()).catch(() => false);
      if (!exists) continue;
      resolved.push({
        attachment: storedAttachment(record),
        absolutePath,
        readableRoot: this.assetDirectory(record.id),
      });
    }
    return resolved;
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private readIndex(): Promise<AttachmentIndex> {
    return readJsonFile(this.indexPath, EMPTY_INDEX).then(normalizeIndex);
  }

  private writeIndex(index: AttachmentIndex): Promise<void> {
    return writeJsonFile(this.indexPath, index, { mode: 0o600 });
  }

  private assetDirectory(assetId: string): string {
    return path.join(this.filesRoot, assertSafeRuntimeId(assetId, 'Attachment id'));
  }

  private filePath(record: StoredAttachmentRecord): string {
    return path.join(this.assetDirectory(record.id), record.fileName);
  }

  private removeAssetDirectory(assetId: string): Promise<void> {
    return rm(this.assetDirectory(assetId), { recursive: true, force: true });
  }

  private removeDiscoveredAssetDirectory(name: string): Promise<void> {
    // `name` 来自 readdir，但递归删除前仍需显式执行范围检查。
    const candidate = path.resolve(this.filesRoot, name);
    if (path.dirname(candidate) !== path.resolve(this.filesRoot)) return Promise.resolve();
    return rm(candidate, { recursive: true, force: true });
  }
}

function validateUpload(input: RuntimeAttachmentUploadInput): {
  name: string;
  type: RuntimeFileAttachmentMimeType;
  data: Buffer;
} {
  const name = safeDisplayName(input.name);
  const data = Buffer.from(input.data);
  if (!data.byteLength) throw new RuntimeAttachmentValidationError('附件不能为空。', 'attachment_empty');
  if (data.byteLength > RUNTIME_FILE_ATTACHMENT_MAX_BYTES) {
    throw new RuntimeAttachmentValidationError('附件不能超过 20 MB。', 'attachment_too_large');
  }
  const extension = path.extname(name).toLowerCase();
  const declaredType = input.type.trim().toLowerCase();
  if (extension === '.pdf' && hasPdfSignature(data) && compatibleDeclaredType(declaredType, PDF_MIME_TYPE)) {
    return { name, type: PDF_MIME_TYPE, data };
  }
  if (extension === '.docx' && hasDocxSignature(data) && compatibleDeclaredType(declaredType, DOCX_MIME_TYPE)) {
    return { name, type: DOCX_MIME_TYPE, data };
  }
  throw new RuntimeAttachmentValidationError('目前仅支持有效的 PDF 和 DOCX 文件。', 'attachment_unsupported');
}

function safeDisplayName(value: string): string {
  const segments = value.trim().split(/[\\/]+/u);
  const baseName = replaceControlCharacters(segments.at(-1) ?? '', '').trim();
  if (!baseName || baseName === '.' || baseName === '..') {
    throw new RuntimeAttachmentValidationError('附件名称无效。', 'attachment_invalid');
  }
  return baseName.slice(0, 255);
}

function safeStoredFileName(name: string, type: RuntimeFileAttachmentMimeType): string {
  const extension = type === PDF_MIME_TYPE ? '.pdf' : '.docx';
  const stem = replaceControlCharacters(name.slice(0, -path.extname(name).length), '_')
    .replace(/[<>:"/\\|?*]/gu, '_')
    .replace(/[. ]+$/u, '')
    .trim()
    .slice(0, 120) || 'attachment';
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(stem);
  return `${windowsReserved ? `_${stem}` : stem}${extension}`;
}

function replaceControlCharacters(value: string, replacement: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? replacement : character;
  }).join('');
}

function compatibleDeclaredType(declared: string, expected: RuntimeFileAttachmentMimeType): boolean {
  return !declared || declared === 'application/octet-stream' || declared === expected;
}

function hasPdfSignature(data: Buffer): boolean {
  return data.subarray(0, 5).toString('ascii') === '%PDF-';
}

function hasDocxSignature(data: Buffer): boolean {
  if (data.byteLength < 4 || data[0] !== 0x50 || data[1] !== 0x4b || ![0x03, 0x05, 0x07].includes(data[2] ?? -1)) return false;
  return data.includes(Buffer.from('[Content_Types].xml')) && data.includes(Buffer.from('word/'));
}

function storedAttachment(record: StoredAttachmentRecord): RuntimeStoredMessageAttachment {
  return {
    id: record.id,
    assetId: record.id,
    source: 'runtime',
    name: record.name,
    type: record.type,
    size: record.size,
  };
}

function cloneAttachment(attachment: RuntimeMessageAttachment): RuntimeMessageAttachment {
  return { ...attachment };
}

function uniqueStoredAttachments(attachments: RuntimeMessageAttachment[]): RuntimeStoredMessageAttachment[] {
  const byId = new Map<string, RuntimeStoredMessageAttachment>();
  for (const attachment of attachments) {
    if (isRuntimeStoredMessageAttachment(attachment)) byId.set(attachment.assetId, attachment);
  }
  return [...byId.values()];
}

function requireMatchingRecord(
  recordsById: Map<string, StoredAttachmentRecord>,
  attachment: RuntimeStoredMessageAttachment,
): StoredAttachmentRecord {
  const record = recordsById.get(assertSafeRuntimeId(attachment.assetId, 'Attachment id'));
  if (!record || !attachmentMatchesRecord(attachment, record)) {
    throw new Error(`Attachment is unavailable or invalid: ${attachment.name}`);
  }
  return record;
}

function attachmentMatchesRecord(attachment: RuntimeStoredMessageAttachment, record: StoredAttachmentRecord): boolean {
  return attachment.id === record.id
    && attachment.name === record.name
    && attachment.type === record.type
    && attachment.size === record.size;
}

function normalizeIndex(value: AttachmentIndex): AttachmentIndex {
  if (!value || value.version !== 1 || !Array.isArray(value.attachments)) return EMPTY_INDEX;
  const attachments = value.attachments.flatMap((record) => {
    if (!record || typeof record !== 'object') return [];
    try {
      const id = assertSafeRuntimeId(String(record.id ?? ''), 'Attachment id');
      const type = record.type === PDF_MIME_TYPE || record.type === DOCX_MIME_TYPE ? record.type : null;
      if (!type || typeof record.name !== 'string' || typeof record.fileName !== 'string' || typeof record.createdAt !== 'string') return [];
      if (!Number.isFinite(record.size) || record.size < 0) return [];
      const fileName = safeStoredFileName(record.fileName, type);
      const threadIds = Array.isArray(record.threadIds)
        ? [...new Set(record.threadIds.flatMap((threadId) => {
            try {
              return [assertSafeRuntimeId(String(threadId), 'Thread id')];
            } catch {
              return [];
            }
          }))]
        : [];
      return [{
        id,
        name: safeDisplayName(record.name),
        type,
        size: Math.floor(record.size),
        fileName,
        createdAt: record.createdAt,
        threadIds,
      } satisfies StoredAttachmentRecord];
    } catch {
      return [];
    }
  });
  return { version: 1, attachments };
}
