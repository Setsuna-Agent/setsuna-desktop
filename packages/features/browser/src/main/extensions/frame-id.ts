import type { WebFrameMain } from 'electron';

// A routing ID belongs to a renderer process; the frame tree ID survives process swaps.
// All extension APIs use this mapping, with Chrome's reserved ID for the top frame.
export function extensionFrameId(frame: WebFrameMain): number {
  return frame.parent === null ? 0 : frame.frameTreeNodeId;
}
