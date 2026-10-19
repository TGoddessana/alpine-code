import { useMemo } from 'react';
import { encode } from 'uqr';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

/** A QR code a phone camera opens. Drawn in the text colour on the raised surface, with the quiet zone it needs. */
export function QrCode({ address, size = 160 }: { address: string; size?: number }) {
  const t = useMessages(messages);
  const { path, modules } = useMemo(() => {
    const { data, size: count } = encode(address, { ecc: 'M', border: 2 });
    let d = '';
    data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return { path: d, modules: count };
  }, [address]);
  return (
    <svg
      role="img"
      aria-label={t.qrLabel(address)}
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-lg bg-canvas-raised text-fg"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
