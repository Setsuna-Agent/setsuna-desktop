import { runtimeText, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type { RuntimeToolDefinition, WorkspaceProject } from '@setsuna-desktop/contracts';
import path from 'node:path';
import type { ToolExecutionContext, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';
import type { WorkspaceProjectStore } from '../../ports/workspace-project-store.js';
import { objectInput, requiredStringArg } from './tool-input.js';
import { workspaceProjectIdForToolContext } from './workspace-tool-context.js';

export const VIEW_IMAGE_TOOL_NAME = 'view_image';

function viewImageTool(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: VIEW_IMAGE_TOOL_NAME,
    description: text('Read a PNG, JPEG, GIF, or WebP image inside the active project workspace so you can inspect its visual content.', "读取当前项目工作区内的 PNG、JPEG、GIF 或 WebP 图片，以检查其视觉内容。"),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: text('Optional registered project id. Defaults to the current project thread, then the temporary workspace.', "可选已注册项目 ID，默认当前项目任务，其次使用临时工作区。") },
        path: { type: 'string', description: text('Image path relative to the project root.', "相对于项目根目录的图片路径。") },
      },
      required: ['path'],
    },
  };
}

/** 提供本地图像感知能力，同时不授予任意文件系统读取权限。 */
export class WorkspaceImageToolHost implements ToolHost {
  constructor(private readonly projects: WorkspaceProjectStore) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return context.modelCapabilities?.supportsImages === true ? [viewImageTool(context.interfaceLanguage)] : [];
  }

  systemPrompt(context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): string | null {
    const text = runtimeText(context.interfaceLanguage);
    if (context.modelCapabilities?.supportsImages !== true
      || (request && !request.tools.some((tool) => tool.name === VIEW_IMAGE_TOOL_NAME))) return null;
    return text('Use view_image for workspace screenshots, design references, and image assets when their visual content matters. Do not use text file tools to read image bytes.', "需要理解工作区截图、设计参考或图像资源的视觉内容时，使用 view_image。不要用文本文件工具读取图片字节。");
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (name !== VIEW_IMAGE_TOOL_NAME) throw new Error(`Unknown tool: ${name}`);
    if (context.modelCapabilities?.supportsImages !== true) {
      throw new Error('The active model does not support image input.');
    }
    const args = objectInput(input);
    const project = await this.projectFor(workspaceProjectIdForToolContext(optionalProjectId(args.projectId), context));
    const relativePath = requiredStringArg(args.path, 'path');
    const image = await this.projects.readImage(project.id, relativePath);
    const namePart = path.basename(image.path) || 'workspace-image';
    const attachmentId = safeIdPart(context.toolCallId ?? `${Date.now()}`);
    return {
      content: `Loaded workspace image ${normalizeDisplayPath(image.path)} (${image.mimeType}, ${image.size} bytes).`,
      attachments: [{
        id: `workspace_image_${attachmentId}`,
        name: namePart,
        type: image.mimeType,
        size: image.size,
        url: `data:${image.mimeType};base64,${image.base64}`,
      }],
      preview: `查看图片 ${normalizeDisplayPath(image.path)}`,
      data: {
        projectId: image.projectId,
        path: normalizeDisplayPath(image.path),
        mimeType: image.mimeType,
        size: image.size,
        modifiedAt: image.modifiedAt,
      },
    };
  }

  private async projectFor(projectId?: string): Promise<WorkspaceProject> {
    const status = await this.projects.getStatus(projectId);
    if (!status.project || !status.exists || !status.readable) {
      throw new Error('No readable workspace is available for view_image.');
    }
    return status.project;
  }
}

function optionalProjectId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/gu, '_').slice(0, 120) || 'image';
}

function normalizeDisplayPath(value: string): string {
  return value.replace(/\\/gu, '/');
}
