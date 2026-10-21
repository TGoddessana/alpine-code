import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement } from 'react';

/**
 * A short label under an icon-only control, shown on hover and keyboard focus. The control keeps its own
 * `aria-label`; the tooltip is only for eyes, so it is never the control's only name.
 */
export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side="bottom" sideOffset={6} className="z-50">
          <BaseTooltip.Popup className="rounded-md bg-fg px-2 py-0.5 text-meta whitespace-nowrap text-canvas-raised transition-opacity duration-(--motion-fast) data-ending-style:opacity-0 data-starting-style:opacity-0">
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

/** Tooltips inside share one delay, so moving along a row of icons shows the next label at once. */
export const TooltipGroup = BaseTooltip.Provider;
