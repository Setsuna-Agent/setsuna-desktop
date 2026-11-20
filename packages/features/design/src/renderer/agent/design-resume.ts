import type { DesignDocument } from '../../contracts/document.js';
import type { DesignScene } from '../design-layout.js';

export function designSavedLocation(document: DesignDocument, scene: DesignScene) {
  const layer = document.lastEditedLayerId;
  if (!layer || !scene[layer]) return;
  let board = layer;
  let section: string | undefined;
  for (let id: string | null = layer; id; id = scene[id].parentId) {
    board = id;
    if (!section && scene[id].parentId && document.nodes[id]?.kind === 'frame') section = id;
  }
  return { layer, board: document.nodes[board].kind === 'frame' ? board : undefined, section };
}

export function designResumeContext(document: DesignDocument, scene: DesignScene) {
  const boards = document.rootIds.filter((id) => document.nodes[id].kind === 'frame');
  const entry = (id: string) => ({ id, name: document.nodes[id].name?.slice(0, 120) ?? document.nodes[id].kind });
  const recent = designSavedLocation(document, scene);
  return { scope: 'document', rootCount: document.rootIds.length, boardCount: boards.length, boards: boards.slice(0, 64).map(entry),
    lastSaved: recent ? { layer: entry(recent.layer), board: recent.board && entry(recent.board), section: recent.section && entry(recent.section) } : null };
}
