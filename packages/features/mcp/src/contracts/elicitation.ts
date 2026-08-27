import type { RuntimeMcpElicitationResponse } from '@setsuna-desktop/contracts';

/**
 * MCP 表单或 URL 信息征询的协议无关桥接请求。
 *
 * 这里故意不出现任何 `@modelcontextprotocol/sdk` 类型：Feature 内的 SDK adapter
 * 负责把协议请求翻译为这些 DTO，再把 host 响应翻译回协议结果。这样
 * desktop-runtime 能在 MCP 边界移除对 SDK 的依赖。
 */
export type McpElicitationRequest =
  | {
      mode: 'form';
      message: string;
      requestedSchema: Record<string, unknown>;
      elicitationId: string;
    }
  | {
      mode: 'url';
      message: string;
      url: string;
      elicitationId: string;
    };

export type McpElicitationContext = {
  threadId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  signal?: AbortSignal;
};

export type McpElicitationResponse = RuntimeMcpElicitationResponse;

/**
 * Feature 依赖的宿主信息征询 handler。
 *
 * desktop-runtime 的 `McpElicitationCoordinator` 实现此接口，负责 thread/turn/
 * tool call 关联、URL 与 schema 安全校验、审批创建与等待，以及 runtime event
 * 写入。SDK 层只负责请求协议往返，不接触审批生命周期。
 */
export type McpElicitationHandler = {
  request(
    serverKey: string,
    request: McpElicitationRequest,
    context: McpElicitationContext,
  ): Promise<McpElicitationResponse>;
};
