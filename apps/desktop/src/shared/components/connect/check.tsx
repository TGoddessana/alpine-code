import type { ConnectionsModelsParams } from '@alpine/protocol';
import { Input, NativeSelect } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';

import { useMessages } from '@/shared/i18n';
import { ServerError, useConnectionModels } from '@/shared/server';

import { messages } from './messages';

/** Waits until typing stops before a value is used. */
function useSettled<T>(value: T, ms = 400): T {
  const [settled, setSettled] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key stands for the value
  }, [key, ms]);
  return settled;
}

export interface ModelCheck {
  /** Something is filled in and being, or has been, checked. */
  active: boolean;
  pending: boolean;
  models?: string[];
  error?: ServerError;
}

/** Lists the connection's models once typing stops, which also checks its key or address. */
export function useModelCheck(params: ConnectionsModelsParams | null): ModelCheck {
  const settled = useSettled(params);
  const query = useConnectionModels(settled);
  const waiting = JSON.stringify(params) !== JSON.stringify(settled);
  return {
    active: params !== null,
    pending: params !== null && (waiting || query.isFetching),
    models: waiting ? undefined : query.data?.models,
    error: !waiting && query.error instanceof ServerError ? query.error : undefined,
  };
}

/** A label and its control, then an optional line under the control. */
export function Form({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-4 gap-y-3">{children}</div>;
}

export function Hint({ id, danger, children }: { id?: string; danger?: boolean; children: ReactNode }) {
  return (
    <p
      id={id}
      role={danger ? 'alert' : undefined}
      className={clsx('col-start-2 -mt-2 text-meta', danger ? 'text-danger' : 'text-fg-muted')}
    >
      {children}
    </p>
  );
}

/** What the check found, worded for its reason. */
export function CheckResult({ id, check, found }: { id: string; check: ModelCheck; found: (count: number) => string }) {
  const t = useMessages(messages);
  if (!check.active) return null;
  if (check.pending) return <Hint id={id}>{t.checking}</Hint>;
  if (check.models) return <Hint id={id}>{found(check.models.length)}</Hint>;
  if (!check.error) return null;
  const reason = check.error.data?.reason;
  const text =
    reason === 'auth'
      ? t.authFailed
      : reason === 'unreachable'
        ? t.unreachable
        : reason === 'unsupported'
          ? t.unsupported
          : t.checkFailed(check.error.message);
  return (
    <Hint id={id} danger={reason !== 'unsupported'}>
      {text}
    </Hint>
  );
}

/** A list of the connection's models, a text field when the server keeps them to itself, else a waiting select. */
export function ModelField({
  id,
  check,
  value,
  onChange,
  waitingText,
}: {
  id: string;
  check: ModelCheck;
  value: string;
  onChange: (model: string) => void;
  waitingText: string;
}) {
  const t = useMessages(messages);
  const models = check.models;
  useEffect(() => {
    if (models && !models.includes(value)) onChange(models[0] ?? '');
  }, [models, value, onChange]);

  if (models)
    return (
      <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {models.map((model) => (
          <option key={model}>{model}</option>
        ))}
      </NativeSelect>
    );
  if (check.error?.data?.reason === 'unsupported')
    return <Input id={id} value={value} placeholder={t.modelPlaceholder} onValueChange={(next) => onChange(next)} />;
  return (
    <NativeSelect id={id} disabled value="">
      <option value="">{waitingText}</option>
    </NativeSelect>
  );
}
