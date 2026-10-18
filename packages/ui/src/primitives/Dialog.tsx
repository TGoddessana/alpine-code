import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import clsx from 'clsx';
import { createContext, useContext, useState, type ComponentProps, type ElementType } from 'react';

type WithClass<T extends ElementType> = Omit<ComponentProps<T>, 'className'> & { className?: string };

const OpenContext = createContext<boolean | undefined>(undefined);

function Root<Payload>(props: BaseDialog.Root.Props<Payload>) {
  return (
    <OpenContext value={props.open}>
      <BaseDialog.Root {...props} />
    </OpenContext>
  );
}
const Trigger = BaseDialog.Trigger;

const widths = { md: 'w-150', sm: 'w-120' };

/** The sheet in the middle of the window, over a scrim. Focus stays inside while it is open. */
function Popup({
  size = 'md',
  className,
  children,
  ...props
}: WithClass<typeof BaseDialog.Popup> & { size?: keyof typeof widths }) {
  const open = useContext(OpenContext);
  const [content, setContent] = useState(children);
  // Controlled dialogs often clear their selection on close. Keep their last frame until Base UI unmounts it.
  if (open !== false && content !== children) setContent(children);
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="motion-backdrop fixed inset-0 z-50 bg-scrim" />
      <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <BaseDialog.Popup
          className={clsx(
            'motion-dialog flex max-w-full flex-col gap-4 rounded-xl border border-line bg-canvas-raised p-6 text-fg shadow-overlay',
            widths[size],
            className,
          )}
          {...props}
        >
          {open === false ? content : children}
        </BaseDialog.Popup>
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
