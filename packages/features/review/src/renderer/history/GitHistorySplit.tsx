import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { useReviewRendererHost } from '../host.js';

export function GitHistorySplit({ files, graph, conflicts }: { files: ReactNode; graph: ReactNode; conflicts?: ReactNode }) {
  const { translate: t } = useReviewRendererHost();
  const [height, setHeight] = useState(30);
  const [graphHeight, setGraphHeight] = useState(50);
  const container = useRef<HTMLDivElement>(null);
  const history = useRef<HTMLDivElement>(null);
  return (
    <div className="git-history-split" ref={container}>
      {files}
      <HistoryResizeHandle
        container={container} label={t('feature.review.history.resize')}
        value={height} min={20} max={75} onChange={setHeight}
      />
      <div className="git-history-split__graph" ref={history} style={{ height: height + '%' }}>
        {conflicts}
        {conflicts ? <>
          <HistoryResizeHandle
            container={history} label={t('feature.review.history.resizeConflictGraph')}
            value={graphHeight} min={20} max={80} onChange={setGraphHeight}
          />
          <div className="git-history-split__commits" style={{ height: graphHeight + '%' }}>{graph}</div>
        </> : graph}
      </div>
    </div>
  );
}

/** Both dividers use their own container's rendered height, including UI zoom. */
function HistoryResizeHandle({ container, label, value, min, max, onChange }: {
  container: RefObject<HTMLDivElement>;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ pointerId: number; y: number; height: number; value: number } | null>(null);
  const change = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return <button
    className="git-history-split__handle"
    type="button"
    role="separator"
    aria-label={label}
    aria-orientation="horizontal"
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={Math.round(value)}
    onPointerDown={(event) => {
      const height = container.current?.getBoundingClientRect().height;
      if (event.button !== 0 || !height) return;
      event.preventDefault();
      drag.current = { pointerId: event.pointerId, y: event.clientY, height, value };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      const start = drag.current;
      if (start?.pointerId !== event.pointerId) return;
      change(start.value + 100 * (start.y - event.clientY) / start.height);
    }}
    onPointerUp={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={(event) => {
      const next = event.key === 'ArrowUp' ? value + 5 : event.key === 'ArrowDown' ? value - 5
        : event.key === 'Home' ? min : event.key === 'End' ? max : null;
      if (next === null) return;
      event.preventDefault();
      change(next);
    }}
  />;
}
