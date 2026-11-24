import { randomUUID } from 'node:crypto';
import type {
  DesignMcpAgent, DesignMcpCanvasEvent, DesignMcpRead, DesignMcpReadResult, DesignMcpReply,
} from '../../contracts/design-mcp.js';

type Canvas = { sender: number; id: string };
type PendingRead = { canvas: Canvas; finish(result: DesignMcpReply): void; cancel(error: string): void };
const inactive = 'Open a design draft in the active Setsuna Desktop window.';
const changed = 'The active design changed. Read get_active_design again.';

export class DesignMcpCanvasBroker {
  private readonly canvases = new Map<number, Set<string>>();
  private readonly pending = new Map<string, PendingRead>();

  constructor(private readonly activeSender: () => number | undefined,
    private readonly send: (sender: number, event: DesignMcpCanvasEvent) => boolean) {}

  setCanvas(sender: number, id: string, visible: boolean): void {
    const canvases = this.canvases.get(sender) ?? new Set<string>();
    canvases.delete(id);
    if (visible) canvases.add(id);
    if (canvases.size) this.canvases.set(sender, canvases);
    else this.canvases.delete(sender);
    this.activeChanged();
  }

  forget(sender: number): void {
    this.canvases.delete(sender);
    this.activeChanged();
  }

  activeChanged(): void {
    const current = this.activeCanvas();
    for (const { canvas, cancel } of this.pending.values()) {
      if (canvas.sender !== current?.sender || canvas.id !== current.id) cancel(changed);
    }
  }

  async read(read: DesignMcpRead, agent: DesignMcpAgent, signal: AbortSignal): Promise<DesignMcpReadResult> {
    signal.throwIfAborted();
    const canvas = this.activeCanvas();
    if (!canvas) throw new Error(inactive);
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (reply: DesignMcpReply) => {
        this.pending.delete(requestId);
        signal.removeEventListener('abort', abort);
        if (reply.ok) resolve(reply.value);
        else reject(new Error(reply.error));
      };
      const cancel = (error: string) => {
        finish({ ok: false, error });
        this.send(canvas.sender, { kind: 'cancel', canvasId: canvas.id, requestId });
      };
      const abort = () => cancel('The design read was cancelled.');
      signal.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, { canvas, finish, cancel });
      if (!this.send(canvas.sender, { kind: 'read', canvasId: canvas.id, requestId, read, agent })) {
        finish({ ok: false, error: inactive });
      }
    });
  }

  reply(sender: number, requestId: string, reply: DesignMcpReply): void {
    this.activeChanged();
    const pending = this.pending.get(requestId);
    if (pending?.canvas.sender === sender) pending.finish(reply);
  }

  private activeCanvas(): Canvas | undefined {
    const sender = this.activeSender();
    if (sender === undefined) return;
    const id = Array.from(this.canvases.get(sender) ?? []).at(-1);
    return id ? { sender, id } : undefined;
  }
}
