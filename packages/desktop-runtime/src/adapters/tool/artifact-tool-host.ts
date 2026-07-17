import path from 'node:path';
import {
  PUBLISH_ARTIFACT_TOOL_NAME,
  type RuntimeArtifact,
  type RuntimeArtifactToolData,
  type RuntimeToolDefinition,
  type WorkspaceProject,
} from '@setsuna-desktop/contracts';
import type { ToolExecutionContext, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';
import type { WorkspaceProjectStore } from '../../ports/workspace-project-store.js';
import { objectInput, optionalStringArg, requiredStringArg } from './tool-input.js';

export { PUBLISH_ARTIFACT_TOOL_NAME };

const PUBLISH_ARTIFACT_TOOL: RuntimeToolDefinition = {
  name: PUBLISH_ARTIFACT_TOOL_NAME,
  description: 'Publish an existing final deliverable from the active workspace so the user can open it directly from the chat response.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      projectId: { type: 'string', description: 'Optional registered project id. Defaults to the current thread workspace, then the temporary workspace.' },
      path: { type: 'string', description: 'Existing deliverable path, relative to the project root or absolute inside that root.' },
    },
    required: ['path'],
  },
};

const artifactMimeTypes: Readonly<Record<string, string>> = {
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.gz': 'application/gzip',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.key': 'application/vnd.apple.keynote',
  '.md': 'text/markdown',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rtf': 'application/rtf',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
};

/** Registers final workspace deliverables without exposing arbitrary filesystem paths. */
export class ArtifactToolHost implements ToolHost {
  constructor(private readonly projects: WorkspaceProjectStore) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [PUBLISH_ARTIFACT_TOOL];
  }

  toolRuntimeProfile(name: string) {
    return name === PUBLISH_ARTIFACT_TOOL_NAME
      ? { exposure: 'direct' as const, supportsParallel: true }
      : null;
  }

  systemPrompt(_context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): string | null {
    if (request && !request.tools.some((tool) => tool.name === PUBLISH_ARTIFACT_TOOL_NAME)) return null;
    return [
      'After creating and verifying a user-facing deliverable file, call publish_artifact once for each final deliverable so it appears as an openable card in the chat.',
      'Deliverables include reports, PDFs, documents, spreadsheets, presentations, images, archives, and media files.',
      'Do not publish source code, helper scripts, caches, or intermediate build files unless the user explicitly requested that file itself as the deliverable.',
    ].join(' ');
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (name !== PUBLISH_ARTIFACT_TOOL_NAME) throw new Error(`Unknown tool: ${name}`);
    const args = objectInput(input);
    const project = await this.projectFor(optionalStringArg(args.projectId) ?? context.projectId);
    const requestedPath = requiredStringArg(args.path, 'path');
    const relativePath = path.isAbsolute(requestedPath)
      ? path.relative(project.path, requestedPath)
      : requestedPath;
    const metadata = await this.projects.inspectFile(project.id, relativePath);
    const artifactPath = normalizeDisplayPath(metadata.path);
    const artifact: RuntimeArtifact = {
      id: `artifact_${safeIdPart(context.toolCallId ?? `${project.id}_${artifactPath}`)}`,
      kind: 'file',
      name: path.basename(artifactPath),
      projectId: project.id,
      workspaceRoot: project.path,
      path: artifactPath,
      mimeType: artifactMimeType(artifactPath),
      size: metadata.size,
      modifiedAt: metadata.modifiedAt,
    };
    const data = { artifact } satisfies RuntimeArtifactToolData;
    return {
      content: `Published artifact ${artifact.path} (${artifact.mimeType}, ${artifact.size} bytes).`,
      preview: `发布产物 ${artifact.path}`,
      data,
    };
  }

  private async projectFor(projectId?: string): Promise<WorkspaceProject> {
    const status = await this.projects.getStatus(projectId);
    if (!status.project || !status.exists || !status.readable) {
      throw new Error('No readable workspace is available for publish_artifact.');
    }
    return status.project;
  }
}

function artifactMimeType(filePath: string): string {
  return artifactMimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function safeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/gu, '_').slice(0, 120) || 'file';
}

function normalizeDisplayPath(value: string): string {
  return value.replace(/\\/gu, '/');
}
