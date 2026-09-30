import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import clsx from 'clsx';
import type { KeyboardEvent, ReactNode } from 'react';

export interface Option<V extends string> {
  value: V;
  label: ReactNode;
  /** One line after the label: what choosing it means. */
  description?: ReactNode;
  disabled?: boolean;
}

export interface OptionListProps<V extends string> {
  options: Option<V>[];
  value: V;
  onValueChange: (value: V) => void;
  'aria-label'?: string;
  className?: string;
}

/**
 * One bordered list of choices, each with its number key. Digits pick a row while focus is inside the list, so
 * they never fight with typing elsewhere.
 */
export function OptionList<V extends string>({
  options,
  value,
  onValueChange,
  className,
  ...aria
}: OptionListProps<V>) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const option = options[Number(event.key) - 1];
    if (option && !option.disabled) {
      event.preventDefault();
      onValueChange(option.value);
    }
  };
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onValueChange(next as V)}
      onKeyDown={onKeyDown}
      className={clsx('flex flex-col overflow-hidden rounded-lg border border-line-subtle', className)}
      {...aria}
    >
      {options.map((option, index) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          nativeButton
          render={<button type="button" />}
          className="group grid w-full cursor-pointer grid-cols-[20px_200px_minmax(0,1fr)] items-start gap-3 px-3 py-2.5 text-left not-first:border-t not-first:border-line-subtle hover:bg-canvas-sunken data-checked:bg-selected data-disabled:cursor-default data-disabled:hover:bg-transparent"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-5 items-center justify-center rounded-sm border border-line bg-canvas-raised text-meta text-fg-muted group-data-checked:border-interactive group-data-checked:text-interactive"
          >
            {index + 1}
          </span>
          <span className="text-body group-data-disabled:text-fg-muted">{option.label}</span>
          <span className="text-meta text-fg-muted">{option.description}</span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
