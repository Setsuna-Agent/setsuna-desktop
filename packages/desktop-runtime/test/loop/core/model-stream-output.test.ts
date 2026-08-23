import { describe, expect, it } from 'vitest';
import {
  createAssistantItemStreamBridge,
  createAssistantOutputAccumulator,
} from '../../../src/loop/core/model-stream-output.js';

describe('createAssistantItemStreamBridge', () => {
  it('keeps reasoning out of visible assistant content without parsing model-authored tags', async () => {
    const visibleDeltas: string[] = [];
    const reasoningDeltas: string[] = [];
    const output = createAssistantOutputAccumulator(async (delta) => {
      visibleDeltas.push(delta);
    }, {
      push: (delta) => ({ visibleText: delta }),
      finish: () => ({ visibleText: '' }),
    });
    const bridge = createAssistantItemStreamBridge(output, async (delta) => {
      reasoningDeltas.push(delta);
    });

    await bridge.appendReasoning('inspect "before<think>private</think>after" & continue');
    await bridge.appendAgent('Visible answer.');
    await bridge.finish();
    await output.finish();

    expect(reasoningDeltas.join('')).toBe('inspect "before<think>private</think>after" & continue');
    expect(visibleDeltas.join('')).toBe('Visible answer.');
    expect(output.text()).toBe('Visible answer.');
  });
});
