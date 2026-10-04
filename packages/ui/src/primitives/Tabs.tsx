import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import clsx from 'clsx';
import type { ComponentProps, ElementType } from 'react';

type WithClass<T extends ElementType> = Omit<ComponentProps<T>, 'className'> & { className?: string };

function Root({ className, ...props }: WithClass<typeof BaseTabs.Root>) {
  return <BaseTabs.Root className={clsx('flex flex-col', className)} {...props} />;
}

function List({ className, ...props }: WithClass<typeof BaseTabs.List>) {
  return <BaseTabs.List className={clsx('flex gap-4 border-b border-line', className)} {...props} />;
}

function Tab({ className, ...props }: WithClass<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={clsx(
        '-mb-px flex min-h-10 cursor-pointer items-center border-b-2 border-transparent px-1 text-body font-medium text-fg-muted hover:text-fg data-active:border-fg data-active:text-fg',
        className,
      )}
      {...props}
    />
  );
}

function Panel({ className, ...props }: WithClass<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={clsx('pt-6', className)} {...props} />;
}

/** Underlined tabs, as on the settings page. */
export const Tabs = { Root, List, Tab, Panel };
