import clsx from 'clsx';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Follows its content's height with the panel motion, so a sheet whose step changes grows or shrinks instead of
 * jumping. The first frame takes the content's own height without moving.
 */
export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    setHeight(element.offsetHeight);
    return () => observer.disconnect();
  }, []);
  return (
    <div className={clsx('motion-auto-height', className)} style={{ height: height ?? undefined }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}
