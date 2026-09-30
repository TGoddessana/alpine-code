import { Input as BaseInput } from '@base-ui/react/input';
import clsx from 'clsx';
import type { ComponentProps } from 'react';

const field =
  'min-h-8 w-full min-w-0 rounded-md border border-line bg-canvas-raised px-2 text-body text-fg outline-none placeholder:text-fg-faint focus:border-interactive focus:ring-1 focus:ring-interactive aria-invalid:border-danger';

export interface InputProps extends Omit<ComponentProps<typeof BaseInput>, 'className'> {
  /** For code: paths, addresses. */
  mono?: boolean;
  className?: string;
}

export function Input({ mono, className, ...props }: InputProps) {
  return <BaseInput className={clsx(field, mono && 'font-mono text-meta', className)} {...props} />;
}

export interface NativeSelectProps extends Omit<ComponentProps<'select'>, 'className'> {
  className?: string;
}

/** The system's own select: its menu, keys and screen reader support come free. */
export function NativeSelect({ className, ...props }: NativeSelectProps) {
  return <select className={clsx(field, 'cursor-pointer', className)} {...props} />;
}
