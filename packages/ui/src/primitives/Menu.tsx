import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import clsx from 'clsx';
import type { ComponentProps, ElementType, ReactNode } from 'react';

type WithClass<T extends ElementType> = Omit<ComponentProps<T>, 'className'> & { className?: string };

const popup =
  'flex min-w-50 flex-col rounded-lg border border-line bg-canvas-raised p-1 text-fg shadow-overlay outline-none';
const row =
  'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-body font-medium outline-none select-none data-highlighted:bg-hover data-disabled:cursor-default data-disabled:text-fg-muted';

interface PopupProps {
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode;
}

function MenuPopup({ side = 'bottom', align = 'start', className, children }: PopupProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side={side} align={align} sideOffset={4} className="outline-none">
        <BaseMenu.Popup className={clsx(popup, className)}>{children}</BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

function ContextPopup({ className, children }: Pick<PopupProps, 'className' | 'children'>) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner className="outline-none">
        <BaseContextMenu.Popup className={clsx(popup, className)}>{children}</BaseContextMenu.Popup>
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  );
}

function Item({ className, ...props }: WithClass<typeof BaseMenu.Item>) {
  return <BaseMenu.Item className={clsx(row, className)} {...props} />;
}

/** One of a set; the chosen one is tinted like a chosen option. */
function RadioItem({ className, ...props }: WithClass<typeof BaseMenu.RadioItem>) {
  return <BaseMenu.RadioItem className={clsx(row, 'data-checked:bg-selected', className)} {...props} />;
}

function Separator({ className, ...props }: WithClass<typeof BaseMenu.Separator>) {
  return <BaseMenu.Separator className={clsx('my-1 border-t border-line-subtle', className)} {...props} />;
}

/** A menu that opens from a button. */
export const Menu = {
  Root: BaseMenu.Root,
  Trigger: BaseMenu.Trigger,
  Popup: MenuPopup,
  Item,
  RadioGroup: BaseMenu.RadioGroup,
  RadioItem,
  Separator,
};

/** A menu that opens where the pointer right-clicks. */
export const ContextMenu = {
  Root: BaseContextMenu.Root,
  Trigger: BaseContextMenu.Trigger,
  Popup: ContextPopup,
  Item,
  Separator,
};
