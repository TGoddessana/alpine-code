import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import clsx from 'clsx';
import type { ComponentProps, ElementType } from 'react';

type WithClass<T extends ElementType> = Omit<ComponentProps<T>, 'className'> & { className?: string };

const Root = BaseDialog.Root;
const Trigger = BaseDialog.Trigger;

const widths = { md: 'w-150', sm: 'w-120' };

/** The sheet in the middle of the window, over a scrim. Focus stays inside while it is open. */
function Popup({
  size = 'md',
  className,
  ...props
}: WithClass<typeof BaseDialog.Popup> & { size?: keyof typeof widths }) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 bg-scrim" />
      <BaseDialog.Viewport className="fixed inset-0 flex items-center justify-center p-6">
        <BaseDialog.Popup
          className={clsx(
            'flex max-w-full flex-col gap-4 rounded-xl border border-line bg-canvas-raised p-6 text-fg shadow-overlay',
            widths[size],
            className,
          )}
          {...props}
        />
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
}

function Title({ className, ...props }: WithClass<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={clsx('text-title', className)} {...props} />;
}

function Description({ className, ...props }: WithClass<typeof BaseDialog.Description>) {
  return <BaseDialog.Description className={clsx('text-body text-fg-muted', className)} {...props} />;
}

const Close = BaseDialog.Close;

/** A modal sheet: the first-run connection, cloning a repository. */
export const Dialog = { Root, Trigger, Popup, Title, Description, Close };
