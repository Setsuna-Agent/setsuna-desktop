import type { ModelClient } from '../../ports/model-client.js';

const DELAY_MS = 35;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TestModelClient implements ModelClient {
  async *stream() {
    const chunks = [
      'Local runtime is online. ',
      'No provider API key is configured yet, so the built-in smoke provider answered locally. ',
      'so no backend Agent API or remote WebView is involved yet.',
    ];

    for (const text of chunks) {
      await sleep(DELAY_MS);
      yield { type: 'text_delta' as const, text };
    }

    yield {
      type: 'usage' as const,
      usage: {
        provider: 'test',
        model: 'local-runtime-smoke',
        inputTokens: 0,
        outputTokens: chunks.join('').length,
        totalTokens: chunks.join('').length,
      },
    };
    yield { type: 'done' as const, finishReason: 'stop' };
  }
}
