import { useState, type ReactNode } from 'react';

/** Intrinsic-height disclosure. Retains content after first opening, including during reversal. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(open);
  if (open && !visited) setVisited(true);
  return (
    <div className="motion-collapse" data-open={open} aria-hidden={!open} inert={!open}>
      <div className="motion-collapse-body">{visited ? children : null}</div>
    </div>
  );
}
