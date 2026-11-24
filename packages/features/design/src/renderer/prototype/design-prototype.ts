import type { DesignDocument, DesignInteraction } from '../../contracts/index.js';
import { isDesignPrototypeBoard } from '../../contracts/document.js';
import { designFrameMask } from '../../contracts/design-references.js';
import type { DesignScene } from '../design-layout.js';

export type PrototypeState = Readonly<{ board: string; history: readonly string[]; overlays: readonly string[] }>;

export function designPrototypeBoards(document: DesignDocument, scene: DesignScene) {
  return document.rootIds.filter((id) => isDesignPrototypeBoard(document.nodes[id]) && scene[id]?.visible);
}

export function designPrototypeBoardFor(id: string | null, scene: DesignScene) {
  if (!id || !scene[id]) return;
  let board = id;
  for (let parent = scene[board].parentId; parent; parent = scene[board].parentId) board = parent;
  return board;
}

export function advanceDesignPrototype(state: PrototypeState, action: DesignInteraction, boards: readonly string[]): PrototypeState {
  if (action.kind === 'close' || action.kind === 'back') {
    if (state.overlays.length) return { ...state, overlays: state.overlays.slice(0, -1) };
    if (action.kind === 'close') return state;
    for (let index = state.history.length - 1; index >= 0; index -= 1) {
      if (boards.includes(state.history[index])) return { board: state.history[index], history: state.history.slice(0, index), overlays: [] };
    }
    return state;
  }
  if (!('targetId' in action) || !boards.includes(action.targetId)) return state;
  if (action.kind === 'overlay') {
    if (action.targetId === state.board || state.overlays.includes(action.targetId)) return state;
    return { ...state, overlays: [...state.overlays, action.targetId] };
  }
  if (action.targetId === state.board) return state.overlays.length ? { ...state, overlays: [] } : state;
  return { board: action.targetId, history: [...state.history, state.board], overlays: [] };
}

export function designPrototypeHotspots(document: DesignDocument, scene: DesignScene, board: string) {
  const hotspots: { id: string; interaction: DesignInteraction; clips: readonly string[] }[] = [];
  function visit(id: string, clips: readonly string[]) {
    const node = document.nodes[id];
    const box = scene[id];
    if (!box?.visible) return;
    if (node.interaction && box.visibleBounds) hotspots.push({ id, interaction: node.interaction, clips });
    // A frame with clipping disabled can have visible children even when its own bounds are off the board.
    if (node.kind !== 'frame' || (node.clip !== false && !box.visibleBounds)) return;
    const mask = designFrameMask(document, node);
    let childClips = node.clip === false ? clips : [...clips, id];
    if (mask) childClips = [...childClips, mask.id];
    for (const child of node.childIds) if (child !== mask?.id) visit(child, childClips);
  }
  visit(board, []);
  return hotspots;
}
