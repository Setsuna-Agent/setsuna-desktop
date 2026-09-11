import { TOOL_OUTPUT_LOCAL_HARD_CAP_BYTES, utf8CharStart } from '../../../loop/tools/tool-output-budget.js';

type OutputStream = 'stdout' | 'stderr';
type OutputChunk = { stream: OutputStream; bytes: Buffer };

/** 正文只交给统一结果存储，不能再随 data 复制进事件和会话快照。 */
export function shellResultMetadata(result: Record<string, unknown>): Record<string, unknown> {
  const metadata = { ...result };
  delete metadata.content;
  delete metadata.display;
  return metadata;
}

/**
 * 尚未交给工具结果层的输出。与用于错误识别的短诊断尾部独立：轮询取走输出，
 * 不会清掉权限错误等诊断；这里也不按模型 token 预算裁剪，由结果层在过滤后保存。
 */
export class ShellOutputBuffer {
  private chunks: OutputChunk[] = [];
  private sizeBytes = 0;
  private omittedBytes = 0;

  constructor(private readonly maxBytes = TOOL_OUTPUT_LOCAL_HARD_CAP_BYTES) {}

  append(stream: OutputStream, text: string): void {
    if (!text) return;
    const bytes = Buffer.from(text, 'utf8');
    this.chunks.push({ stream, bytes });
    this.sizeBytes += bytes.length;

    // 保留最近输出，丢弃仅发生在本地硬上限；边界按 UTF-8 字符对齐。
    while (this.sizeBytes > this.maxBytes) {
      const first = this.chunks[0];
      const removed = utf8CharStart(first.bytes, Math.min(first.bytes.length, this.sizeBytes - this.maxBytes));
      this.sizeBytes -= removed;
      this.omittedBytes += removed;
      if (removed === first.bytes.length) this.chunks.shift();
      else first.bytes = Buffer.from(first.bytes.subarray(removed));
    }
  }

  take(): { stdout: string; stderr: string; omittedBytes: number } {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    for (const chunk of this.chunks) {
      (chunk.stream === 'stdout' ? stdout : stderr).push(chunk.bytes);
    }
    const result = {
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      omittedBytes: this.omittedBytes,
    };
    this.chunks = [];
    this.sizeBytes = 0;
    this.omittedBytes = 0;
    return result;
  }
}
