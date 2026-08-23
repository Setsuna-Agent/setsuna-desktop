import {
  createNoopMemoryControl,
  type MemoryControl,
  type MemoryToolContext,
} from '@setsuna-desktop/feature-memory/contracts';
import type {
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHost,
} from '../../ports/tool-host.js';

/** Bindable ToolHost adapter; Memory owns every definition and execution rule. */
export class MemoryToolHost implements ToolHost {
  private control: MemoryControl = createNoopMemoryControl();

  bind(control: MemoryControl): void {
    if (this.control.available && this.control !== control) {
      throw new Error('Memory tool service is already bound.');
    }
    this.control = control;
  }

  systemPrompt(context: ToolExecutionContext): Promise<string | null> {
    return this.control.systemPrompt(memoryContext(context));
  }

  async listTools(context: ToolExecutionContext) {
    return [...await this.control.listTools(memoryContext(context))];
  }

  toolRuntimeProfile(name: string) {
    return this.control.toolRuntimeProfile(name);
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    return this.control.runTool(name, input, memoryContext(context));
  }
}

function memoryContext(context: ToolExecutionContext): MemoryToolContext {
  return Object.freeze({
    threadId: context.threadId,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.features ? { features: context.features } : {}),
  });
}
