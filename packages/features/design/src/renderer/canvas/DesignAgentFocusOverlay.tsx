import { MousePointer2 } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { designFocusCorner, type DesignBoardFocus } from '../agent/design-agent-focus.js';
import { containsBounds, unionBounds } from '../design-geometry.js';
import type { DesignScene } from '../design-layout.js';
import type { CanvasViewport } from '../use-design-canvas-gestures.js';
import './design-agent-selection-glow.css';

type OverlayView = Readonly<{ scene: DesignScene; viewport: CanvasViewport }>;

export function DesignAgentFocusOverlays({ targets, scene, viewport }: OverlayView & { targets: readonly DesignBoardFocus[] }) {
  const occupied = new Map<string, number>();
  return targets.map((target) => {
    // Keep names legible when multiple agents point to exactly the same canvas corner.
    const point = designFocusCorner(scene, target.ids) ?? target.point;
    const anchor = [Math.round(point.x * viewport.scale), Math.round(point.y * viewport.scale)].join(',');
    const row = occupied.get(anchor) ?? 0;
    occupied.set(anchor, row + 1);
    return <DesignAgentFocusOverlay key={JSON.stringify([target.agent?.threadId, target.boardId])} target={target} point={point}
      scene={scene} viewport={viewport} cursorOffset={row * 22} />;
  });
}

function DesignAgentFocusOverlay({ target, point, scene, viewport, cursorOffset }: OverlayView & Readonly<{
  target: DesignBoardFocus;
  point: DesignBoardFocus['point'];
  cursorOffset: number;
}>) {
  const { ids, agent } = target;
  const color = agent ? { '--design-agent-color': `hsl(${(194 + 137.508 * agent.colorIndex) % 360} 72% 45%)` } as CSSProperties : undefined;
  const glow = useMemo(() => {
    const box = ids.length === 1 ? scene[ids[0]] : undefined;
    if (box?.visibleBounds && containsBounds(box.visibleBounds, box.paintBounds)) {
      const { absoluteX: x, absoluteY: y, width, height, angle, scaleX, scaleY } = box;
      return { bounds: { x, y, width, height }, transform: `rotate(${angle}deg) scale(${scaleX}, ${scaleY})` };
    }
    const bounds = unionBounds(ids.flatMap((id) => {
      const visible = scene[id]?.visibleBounds;
      return visible ? [visible] : [];
    }));
    return bounds && { bounds, transform: undefined };
  }, [ids, scene]);

  const { x, y, scale } = viewport;
  return <>
    {glow && <svg className="design-agent-selection-glow" aria-hidden="true" width={glow.bounds.width * scale}
      height={glow.bounds.height * scale} style={{
        ...color, left: x + glow.bounds.x * scale, top: y + glow.bounds.y * scale, transform: glow.transform,
      }}>
      <rect className="design-agent-selection-glow__trail" width="100%" height="100%" rx="2" pathLength={100} />
      <rect className="design-agent-selection-glow__tip" width="100%" height="100%" rx="2" pathLength={100} />
    </svg>}
    <span className="design-agent-cursor" aria-hidden="true" style={{ ...color, left: x + point.x * scale, top: y + point.y * scale + cursorOffset }}>
      {cursorOffset > 0 && <i className="design-agent-cursor__leader" style={{ height: cursorOffset }} />}
      <MousePointer2 size={20} strokeWidth={1.5} />
      {agent && <span className="design-agent-cursor__name">{agent.name}</span>}
    </span>
  </>;
}
