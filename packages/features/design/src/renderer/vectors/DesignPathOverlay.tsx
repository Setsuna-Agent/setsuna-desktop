import { Circle, Group, Line, Path, Rect } from 'react-konva';
import type { DesignPathAnchor } from '../../contracts/index.js';
import { designSelectionColor, DimensionTag } from '../DesignCanvasSelection.js';
import { roundDesignValue, toWorld, type DesignTransform, type Point } from '../design-geometry.js';
import { designSegmentMeasurements } from './design-path-edit.js';
import { designPathData } from './design-vector.js';

export function DesignPathOverlay({ anchors, cursor, closing, closed, selected, pose, scale, drawing = false, showPath = true, endpoints = false }: Readonly<{
  anchors: readonly DesignPathAnchor[];
  cursor?: Point;
  closing?: boolean;
  closed?: boolean;
  selected?: number;
  pose?: DesignTransform;
  scale: number;
  drawing?: boolean;
  showPath?: boolean;
  endpoints?: boolean;
}>) {
  const last = anchors.at(-1);
  const sw = 1 / scale;
  const tail = cursor && last ? designPathData([last, { ...cursor, incoming: closing ? anchors[0].incoming : undefined }]) : undefined;
  return <>
    <Group listening={false} x={pose?.absoluteX} y={pose?.absoluteY} rotation={pose?.angle} scaleX={pose?.scaleX} scaleY={pose?.scaleY}>
      {showPath ? <Path data={designPathData(anchors, closed)} stroke={designSelectionColor} strokeWidth={sw} lineJoin="round" lineCap="round" /> : null}
      {tail ? <Path data={tail} stroke={designSelectionColor} strokeWidth={sw} opacity={0.64} /> : null}
      {anchors.map((anchor, index) => {
        const active = drawing ? anchor === last : index === selected;
        if (endpoints) return <Rect key={index} x={anchor.x - 3.5 * sw} y={anchor.y - 3.5 * sw} width={7 * sw} height={7 * sw}
          fill={active ? designSelectionColor : '#fff'} stroke={designSelectionColor} strokeWidth={sw} />;
        return <Group key={index}>
          {active ? [anchor.incoming, anchor.outgoing].map((handle, part) => handle ? <Group key={part}>
            <Line points={[anchor.x, anchor.y, handle.x, handle.y]} stroke={designSelectionColor} strokeWidth={sw} opacity={0.65} />
            <Circle x={handle.x} y={handle.y} radius={3 * sw} fill={designSelectionColor} />
          </Group> : null) : null}
          <Circle x={anchor.x} y={anchor.y} radius={(closing && index === 0 ? 5 : 3.5) * sw}
            fill={active || (closing && index === 0) ? designSelectionColor : '#fff'} stroke={designSelectionColor} strokeWidth={sw} />
        </Group>;
      })}
    </Group>
    {endpoints && last ? <SegmentLength start={toWorld(pose, anchors[0])} end={toWorld(pose, last)} scale={scale} /> : null}
  </>;
}

function SegmentLength({ start, end, scale }: Readonly<{ start: Point; end: Point; scale: number }>) {
  const { length, angle } = designSegmentMeasurements(start, end);
  if (!length) return null;
  const rotation = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;
  return <Group x={(start.x + end.x) / 2} y={(start.y + end.y) / 2} rotation={rotation} listening={false}>
    <DimensionTag width={0} height={0} scale={scale} label={String(roundDesignValue(length))} />
  </Group>;
}
