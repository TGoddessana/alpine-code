import type { FlowGetResult } from '@alpine/protocol';
import { Button, Menu } from '@alpine/ui/primitives';
import { Check, Ellipsis, X } from 'lucide-react';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { ServerError, useDeleteMap, useSetSchedule, useSetScope } from '@/shared/server';

import { messages } from './messages';

/*
 * The map's settings have no window of their own. Before the map exists the scope shows on the empty screen; once it
 * exists, everything used now and then (history, finding more, a new flow, the daily check, the scope, deleting) sits
 * in one "⋯" menu, and the scope editor or the delete confirmation opens as a strip under the header.
 */

/** Keeps a typed folder as a project-relative path with forward slashes. */
const clean = (value: string) =>
  value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');

/** Which folders the map covers (the user's choice): chips to remove, a field to add one with Enter. */
export function ScopeEditor({
  cwd,
  board,
  readOnly,
  label,
}: {
  cwd: string;
  board: FlowGetResult;
  readOnly: boolean;
  /** The words in front, e.g. "지도로 만들 폴더" before the map exists. */
  label: string;
}) {
  const t = useMessages(messages);
  const scope = useSetScope();
  const [path, setPath] = useState('');
  const include = board.include ?? [];
  const save = (next: string[]) => scope.mutate({ cwd, include: next });
  return (
    <section aria-label={t.scopeTitle} className="flex flex-col gap-1">
      <form
        className="flex flex-wrap items-center gap-1.5 text-meta"
        onSubmit={(event) => {
          event.preventDefault();
          const value = clean(path);
          if (value && !include.includes(value)) save([...include, value]);
          setPath('');
        }}
      >
        <span className="text-fg-muted">{label}</span>
        {include.length ? (
          include.map((item) => (
            <span key={item} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 font-mono">
              {item}
              <button
                type="button"
                disabled={readOnly || scope.isPending}
                aria-label={t.scopeRemove(item)}
                onClick={() => save(include.filter((other) => other !== item))}
                className="cursor-pointer text-fg-muted hover:text-fg disabled:cursor-default"
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ))
        ) : (
          <span>{t.scopeAll}</span>
        )}
        {!readOnly && (
          <input
            type="text"
            aria-label={t.scopeLabel}
            value={path}
            placeholder={t.scopeAddPlaceholder}
            onChange={(event) => setPath(event.target.value)}
            className="w-32 min-w-0 grow rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-mono outline-none placeholder:text-fg-faint focus:border-interactive"
          />
        )}
      </form>
      {scope.isError && (
        <p role="alert" className="text-meta text-danger">
          {t.scopeFailed}
        </p>
      )}
    </section>
  );
}

/** Everything used now and then, behind one "⋯"; a dot on it says the history has something new. */
export function MapMenu({
  cwd,
  board,
  readOnly,
  unseen,
  canStart,
  onChanges,
  onRediscover,
  onScope,
  onDelete,
  recheck,
  onRecheck,
}: {
  cwd: string;
  board: FlowGetResult;
  readOnly: boolean;
  unseen: number;
  /** Whether a new run may start now (nothing else working, map writable). */
  canStart: boolean;
  onChanges?: () => void;
  onRediscover: () => void;
  onScope: () => void;
  onDelete: () => void;
  /** How many features changed since their check; they can all be checked again from here. */
  recheck: number;
  onRecheck: () => void;
}) {
  const t = useMessages(messages);
  const schedule = useSetSchedule();
  const daily = board.schedule ?? { enabled: false, limit: 20, lastRun: null };
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t.mapMenu}
        className="relative flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-hover data-popup-open:bg-hover"
      >
        <Ellipsis size={18} aria-hidden />
        {unseen > 0 && <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-interactive" />}
      </Menu.Trigger>
      <Menu.Popup align="end">
        {onChanges && <Menu.Item onClick={onChanges}>{t.menuChanges(unseen)}</Menu.Item>}
        <Menu.Item disabled={!canStart} onClick={onRediscover}>
          {t.rediscover}
        </Menu.Item>
        {recheck > 0 && (
          <Menu.Item disabled={!canStart} onClick={onRecheck}>
            {t.recheckAll(recheck)}
          </Menu.Item>
        )}
        <Menu.Separator />
        <Menu.Item
          role="menuitemcheckbox"
          aria-checked={daily.enabled ?? false}
          disabled={readOnly || schedule.isPending}
          closeOnClick={false}
          onClick={() => schedule.mutate({ cwd, enabled: !daily.enabled, limit: daily.limit ?? 20 })}
        >
          <span className="grow">{t.menuDaily}</span>
          <Check size={14} aria-hidden className={daily.enabled ? 'text-interactive' : 'invisible'} />
        </Menu.Item>
        <Menu.Item onClick={onScope}>{t.menuScope}</Menu.Item>
        {!readOnly && (
          <>
            <Menu.Separator />
            <Menu.Item onClick={onDelete} className="text-danger">
              {t.deleteMap}
            </Menu.Item>
          </>
        )}
      </Menu.Popup>
    </Menu.Root>
  );
}

/** The delete confirmation, as a strip under the header (opened from the menu). */
export function DeleteMap({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const t = useMessages(messages);
  const remove = useDeleteMap();
  const busy = remove.error instanceof ServerError && remove.error.data?.reason === 'flow_busy';
  return (
    <section
      aria-label={t.deleteMap}
      className="flex flex-wrap items-center gap-3 border-b border-line bg-canvas-sunken px-5 py-3 text-body"
    >
      <span className="min-w-0 grow">
        {t.deleteConfirm}
        {remove.isError && (
          <span role="alert" className="mt-1 block text-meta text-danger">
            {busy ? t.deleteBusy : t.deleteFailed}
          </span>
        )}
      </span>
      <Button
        variant="danger"
        disabled={remove.isPending}
        onClick={() => remove.mutate({ cwd }, { onSuccess: onClose })}
      >
        {t.deleteMapNow}
      </Button>
      <Button onClick={onClose}>{t.cancel}</Button>
    </section>
  );
}
