import { useState, type ReactNode } from 'react';

/** Retains the outgoing surface while its space closes, and reverses from the current width. */
export function SlidingPanel({ open, width, children }: { open: boolean; width: number; children: ReactNode }) {
  const [content, setContent] = useState(open ? children : null);
  if (open && content !== children) setContent(children);
  return (
    <div
      className="motion-side-panel"
      style={{ width: open ? width : 0 }}
      data-open={open}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="motion-side-panel-body" style={{ width }}>
        {open ? children : content}
      </div>
    </div>
  );
}
