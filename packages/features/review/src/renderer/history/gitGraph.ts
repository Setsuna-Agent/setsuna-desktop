import type { DesktopGitCommit } from '../../contracts/index.js';

export const GIT_GRAPH_ROW_HEIGHT = 28;
export const GIT_GRAPH_LANE_WIDTH = 12;
const COLORS = [
  'var(--desktop-git-graph-blue)',
  'var(--desktop-git-graph-teal)',
  'var(--desktop-git-graph-purple)',
  'var(--desktop-git-graph-yellow)',
  'var(--desktop-git-graph-indigo)',
  'var(--desktop-git-graph-orange)',
];
type Lane = { oid: string; color: string };
export type GitGraphEdge = { from: number; to: number; start: number; end: number; color: string };
export type GitGraphRow = { lane: number; color: string; columns: number; edges: GitGraphEdge[] };

/** Carry pending parents between topologically ordered rows; matching parents share a lane. */
export function layoutGitHistory(commits: readonly DesktopGitCommit[]): GitGraphRow[] {
  let lanes: Lane[] = [];
  let colorIndex = 0;
  return commits.map((commit) => {
    const incoming = lanes;
    const existing = incoming.findIndex((entry) => entry.oid === commit.oid);
    const lane = existing < 0 ? incoming.length : existing;
    const color = existing < 0 ? COLORS[colorIndex++ % COLORS.length] : incoming[lane].color;
    const outgoing = incoming.filter((entry) => entry.oid !== commit.oid);
    for (const [index, oid] of commit.parents.entries()) {
      if (outgoing.some((entry) => entry.oid === oid)) continue;
      const parent = { oid, color: index === 0 ? color : COLORS[colorIndex++ % COLORS.length] };
      outgoing.splice(index === 0 ? Math.min(lane, outgoing.length) : outgoing.length, 0, parent);
    }
    const edges: GitGraphEdge[] = incoming.map((entry, index) => ({
      from: index,
      to: entry.oid === commit.oid ? lane : outgoing.findIndex((candidate) => candidate.oid === entry.oid),
      start: 0,
      end: entry.oid === commit.oid ? GIT_GRAPH_ROW_HEIGHT / 2 : GIT_GRAPH_ROW_HEIGHT,
      color: entry.color,
    }));
    for (const oid of commit.parents) {
      const target = outgoing.findIndex((entry) => entry.oid === oid);
      edges.push({ from: lane, to: target, start: GIT_GRAPH_ROW_HEIGHT / 2, end: GIT_GRAPH_ROW_HEIGHT, color: outgoing[target].color });
    }
    lanes = outgoing;
    return { lane, color, columns: Math.max(lane + 1, incoming.length, outgoing.length), edges };
  });
}
