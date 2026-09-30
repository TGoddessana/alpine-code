import { Button as BaseButton } from '@base-ui/react/button';
import clsx from 'clsx';
import type { ComponentProps } from 'react';

const variants = {
  /** The one filled button on a screen. */
  primary: 'border-interactive bg-interactive text-on-fill hover:bg-interactive-hover',
  secondary: 'border-line bg-canvas-raised text-fg hover:bg-canvas-sunken',
  /** Confirms something that cannot be undone. */
  danger: 'border-danger bg-danger text-on-fill hover:bg-danger-hover',
};

export interface ButtonProps extends Omit<ComponentProps<typeof BaseButton>, 'className'> {
  variant?: keyof typeof variants;
  className?: string;
}

export function Button({ variant = 'secondary', className, ...props }: ButtonProps) {
  return (
    <BaseButton
      className={clsx(
        'inline-flex min-h-8 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-body whitespace-nowrap data-disabled:cursor-default data-disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
