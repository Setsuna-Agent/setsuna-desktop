import { runtimeText, type RuntimeInterfaceLanguage, type RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { TOOL_PROGRAM_VALUE_BYTES, type ToolProgramRuntime } from '../../ports/tool-program-runtime.js';
import { ToolCallScheduler } from './tool-call-scheduler.js';
import { abortable } from '../core/runtime-turn-errors.js';

export const RUN_CODE_TOOL_NAME = 'run_code';

export function runCodeDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: RUN_CODE_TOOL_NAME,
    description: text(
      'Run isolated JavaScript to compose tools and filter large intermediate results. Use await tools.NAME(args); returns {content, tool_call_id, result_id?}. Only text(...), print(...) or console.log(...) enters model context. ALL_TOOLS lists allowed names/descriptions. store(key, value) and load(key) explicitly retain JSON across this thread’s calls (2 MiB/value, 4 MiB/thread, 128 keys); values are volatile and idle threads may be evicted. Ordinary variables never persist. Use search_tools first for unknown schemas. Native tool calls remain available. No Node, filesystem, network or imports. Up to 64 calls, 6 concurrent safe reads, 120 seconds, 64 KiB printed output. Writes and approvals use normal policy; a failed program may have effects, so inspect before retrying. Await all calls. Example: const r = await tools.read_file({file_path:"README.md"}); print(r.content.slice(0,1000));',
      '执行隔离 JavaScript，组合工具并筛选大型中间结果。使用 await tools.工具名(参数)，返回 {content, tool_call_id, result_id?}；仅 text(...)、print(...) 或 console.log(...) 的内容进入模型上下文。ALL_TOOLS 列出允许工具的名称与描述。通过 store(key, value)/load(key) 显式跨调用保留本线程 JSON 数据（单值 2 MiB、线程 4 MiB、128 个键）；数据不跨重启，闲置线程可能淘汰。普通变量不保留。未知工具先用 search_tools 获取结构，也可继续直接调用工具。没有 Node、文件系统、网络或 import。最多 64 次调用、6 个安全读取并发、120 秒、64 KiB 输出。写入与审批遵循原有策略；程序失败可能已有副作用，重试前检查。必须 await 所有调用。示例：const r = await tools.read_file({file_path:"README.md"}); print(r.content.slice(0,1000));',
    ),
    inputSchema: { type: 'object', properties: { code: { type: 'string', maxLength: 32_768 } }, required: ['code'], additionalProperties: false },
  };
}

export async function runToolProgram(input: {
  arguments: unknown;
  runtime: ToolProgramRuntime;
  toolNames: string[];
  sessionId?: string;
  toolCatalog?: Array<{ name: string; description: string }>;
  signal: AbortSignal;
  canRunInParallel(name: string, args: unknown): Promise<boolean>;
  callTool(name: string, args: unknown, signal: AbortSignal, observationStep: number): Promise<{ content: string; tool_call_id: string; result_id?: string }>;
}): Promise<string> {
  const code = input.arguments && typeof input.arguments === 'object' ? (input.arguments as Record<string, unknown>).code : undefined;
  if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code) > 32_768) throw new Error('run_code requires code within 32 KiB.');
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  const scheduler = new ToolCallScheduler(6, signal);
  // Classification can await policy. Serialize admission so an exclusive call remains
  // a barrier even when a later read has a faster policy lookup.
  let admission = Promise.resolve();
  try {
    return await input.runtime.execute({ code, toolNames: input.toolNames, sessionId: input.sessionId, toolCatalog: input.toolCatalog, signal,
      callTool: (name, args, submittedStep) => new Promise((resolve, reject) => {
        // Preserve the worker's submission step through policy and execution queues.
        // A result completed here may not yet have been delivered to the program.
        admission = admission.then(async () => {
          signal.throwIfAborted();
          const parallel = await abortable(input.canRunInParallel(name, args), signal);
          void scheduler.run(parallel, async () => {
            const result = await input.callTool(name, args, signal, submittedStep);
            if (Buffer.byteLength(JSON.stringify(result)) > TOOL_PROGRAM_VALUE_BYTES) throw new Error('Result too large; request a smaller range.');
            return result;
          }).then(resolve, reject);
        }).catch(reject);
      }),
    });
  } finally {
    controller.abort(new Error('Tool program ended.'));
    await admission;
    await scheduler.close();
  }
}
