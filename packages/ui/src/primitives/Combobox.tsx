import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import clsx from 'clsx';
import type { ComponentProps, ElementType, ReactNode } from 'react';

type WithClass<T extends ElementType> = Omit<ComponentProps<T>, 'className'> & { className?: string };

const row =
  'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-body font-medium outline-none select-none data-highlighted:bg-hover data-selected:bg-selected';

interface PopupProps {
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode;
}

/** A menu with a search box at its top, like the Menu popup. Put `Combobox.Input` first inside it. */
function Popup({ side = 'bottom', align = 'start', className, children }: PopupProps) {
  return (
    <BaseCombobox.Portal>
      <BaseCombobox.Positioner side={side} align={align} sideOffset={4} className="outline-none">
        <BaseCombobox.Popup
          className={clsx(
            'flex min-w-50 flex-col rounded-lg border border-line bg-canvas-raised p-1 text-fg shadow-overlay outline-none',
            className,
          )}
        >
          {children}
        </BaseCombobox.Popup>
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  );
}

function Input({ className, ...props }: WithClass<typeof BaseCombobox.Input>) {
  return (
    <BaseCombobox.Input
      className={clsx(
        'mb-1 min-h-8 w-full rounded-md border border-line bg-canvas-raised px-2 text-body text-fg outline-none placeholder:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

function List({ className, ...props }: WithClass<typeof BaseCombobox.List>) {
  return <BaseCombobox.List className={clsx('min-h-0 overflow-y-auto overscroll-contain', className)} {...props} />;
}

function Item({ className, ...props }: WithClass<typeof BaseCombobox.Item>) {
  return <BaseCombobox.Item className={clsx(row, className)} {...props} />;
}

function GroupLabel({ className, ...props }: WithClass<typeof BaseCombobox.GroupLabel>) {
  return (
    <BaseCombobox.GroupLabel
      className={clsx(
        'flex min-h-7 items-center gap-2 px-2 text-meta font-semibold text-fg-muted select-none',
        className,
      )}
      {...props}
    />
  );
}

function Empty({ className, ...props }: WithClass<typeof BaseCombobox.Empty>) {
  return <BaseCombobox.Empty className={clsx('px-2 text-meta text-fg-muted empty:hidden', className)} {...props} />;
}

/** A list to choose from with a search box, grouped when its items are groups. */
export const Combobox = {
  Root: BaseCombobox.Root,
  Trigger: BaseCombobox.Trigger,
  Popup,
  Input,
  List,
  Group: BaseCombobox.Group,
  GroupLabel,
  Collection: BaseCombobox.Collection,
  Item,
  Empty,
};
