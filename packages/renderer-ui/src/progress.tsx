export function ProgressRing({ percent, size = 16, strokeWidth = 8, className = '', 'aria-label': label }: { percent: number; size?: number; strokeWidth?: number; className?: string; 'aria-label'?: string }) {
  const value = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const radius = 50 - strokeWidth / 2;
  return <svg aria-label={label} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} viewBox="0 0 100 100" width={size} height={size} className={`sd-progress-ring ${className}`}>
    <circle className="sd-progress-ring__track" cx="50" cy="50" r={radius} fill="none" strokeWidth={strokeWidth} />
    <circle className="sd-progress-ring__value" cx="50" cy="50" r={radius} fill="none" strokeWidth={strokeWidth} pathLength="100" strokeDasharray={`${value} 100`} transform="rotate(-90 50 50)" />
  </svg>;
}
