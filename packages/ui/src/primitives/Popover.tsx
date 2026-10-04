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
      <BasePopover.Positioner side={side} align={align} sideOffset={8} className="outline-none">
        <BasePopover.Popup
          className={clsx(
            'flex flex-col gap-3 rounded-xl border border-line bg-canvas-raised p-4 text-fg shadow-overlay outline-none',
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
