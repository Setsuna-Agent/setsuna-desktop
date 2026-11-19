import { Circle, Group, Line, Path } from 'react-konva';
import type { DesignPathAnchor } from '../../contracts/index.js';
import { designSelectionColor } from '../DesignCanvasSelection.js';
import type { DesignTransform, Point } from '../design-geometry.js';
import { designPathData } from './design-vector.js';

export function DesignPathOverlay({ anchors, cursor, closing, closed, selected, pose, scale, drawing = false }: Readonly<{
  anchors: readonly DesignPathAnchor[];
  cursor?: Point;
  closing?: boolean;
  closed?: boolean;
  selected?: number;
  pose?: DesignTransform;
  scale: number;
  drawing?: boolean;
}>) {
  const last = anchors.at(-1);
  const sw = 1 / scale;
  const tail = cursor && last ? designPathData([last, { ...cursor, incoming: closing ? anchors[0].incoming : undefined }]) : undefined;
  return <Group listening={false} x={pose?.absoluteX} y={pose?.absoluteY} rotation={pose?.angle} scaleX={pose?.scaleX} scaleY={pose?.scaleY}>
    <Path data={designPathData(anchors, closed)} stroke={designSelectionColor} strokeWidth={sw} lineJoin="round" lineCap="round" />
    {tail ? <Path data={tail} stroke={designSelectionColor} strokeWidth={sw} opacity={0.64} /> : null}
    {anchors.map((anchor, index) => {
      const active = drawing ? anchor === last : index === selected;
      return <Group key={index}>
        {active ? [anchor.incoming, anchor.outgoing].map((handle, part) => handle ? <Group key={part}>
          <Line points={[anchor.x, anchor.y, handle.x, handle.y]} stroke={designSelectionColor} strokeWidth={sw} opacity={0.65} />
          <Circle x={handle.x} y={handle.y} radius={3 * sw} fill={designSelectionColor} />
        </Group> : null) : null}
        <Circle x={anchor.x} y={anchor.y} radius={(closing && index === 0 ? 5 : 3.5) * sw}
          fill={active || (closing && index === 0) ? designSelectionColor : '#fff'} stroke={designSelectionColor} strokeWidth={sw} />
      </Group>;
    })}
  </Group>;
}
