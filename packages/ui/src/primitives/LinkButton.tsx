import clsx from 'clsx';
import type { ComponentProps } from 'react';

export interface LinkButtonProps extends Omit<ComponentProps<'button'>, 'className'> {
  className?: string;
}

/** A small text action: '‹ back', 'change', 'details ›'. */
export function LinkButton({ className, type = 'button', ...props }: LinkButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex min-h-7 cursor-pointer items-center rounded-sm px-1 text-meta whitespace-nowrap text-interactive hover:text-interactive-hover hover:underline',
        className,
      )}
      {...props}
    />
  );
}
