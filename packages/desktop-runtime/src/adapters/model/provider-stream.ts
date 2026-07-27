import type { ModelStreamEvent } from '@setsuna-desktop/contracts';

export async function* parseSse(response: Response): AsyncGenerator<{ event?: string; data: string }> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(/(?:\r\n|\r|\n){2}/);
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const parsed = parseSseEventBlock(chunk);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    const parsed = parseSseEventBlock(buffer);
    if (parsed) yield parsed;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Model stream returned invalid JSON: ${detail}`);
  }
}

export function doneEvent(finishReason?: string): ModelStreamEvent {
  return { type: 'done', finishReason };
}

function parseSseEventBlock(block: string): { event?: string; data: string } | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value.trim();
    if (field === 'data') dataLines.push(value);
  }
  if (!dataLines.length) return null;
  const data = dataLines.join('\n');
  return data ? { ...(event ? { event } : {}), data } : null;
}
