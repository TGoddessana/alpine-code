import { Popover as BasePopover } from '@base-ui/react/popover';
import clsx from 'clsx';
import type { ReactNode } from 'react';

interface PopupProps {
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode;
}

/** A small sheet beside the button that opened it, looking like a menu. A click outside or Esc closes it. */
function Popup({ side = 'bottom', align = 'start', className, children }: PopupProps) {
  return (
    <BasePopover.Portal>
      {/* A sheet taller than the room stays on its side and scrolls, instead of jumping beside its button. */}
      <BasePopover.Positioner
        side={side}
        align={align}
        sideOffset={8}
        collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
        className="z-50 outline-none"
      >
        <BasePopover.Popup
          className={clsx(
            // Never taller than the room left on its side; a long sheet scrolls inside.
            'motion-popup flex max-h-(--available-height) flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-canvas-raised p-4 text-fg shadow-overlay outline-none',
            className,
          )}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

/** Extra detail that opens from a button and is read, not acted on. */
export const Popover = {
  Root: BasePopover.Root,
  Trigger: BasePopover.Trigger,
  Popup,
  Title: BasePopover.Title,
};
