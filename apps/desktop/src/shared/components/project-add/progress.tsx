import clsx from 'clsx';

/** How far a clone got, as a thin bar; `className` sets its width. */
export function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={clsx('h-1 overflow-hidden rounded-full bg-line', className)}
    >
      <div className="h-full rounded-full bg-fg-muted" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Bytes as people read them: 820KB, 4.2MB, 52MB, 1.3GB. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 && unit > 1 ? 1 : 0;
  return `${value.toFixed(digits)}${units[unit]}`;
}
