import clsx from 'clsx';

/** The same approved raster master used by the app icon, site and documentation. */
export function BrandMark({ size = 64, label = '', className }: { size?: number; label?: string; className?: string }) {
  return (
    <img
      src="/brand/hare.png"
      width={size}
      height={size}
      alt={label}
      draggable={false}
      className={clsx('shrink-0', className)}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
