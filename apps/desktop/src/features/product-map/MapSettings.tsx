import type { FlowGetResult } from '@alpine/protocol';
import { Button, Menu } from '@alpine/ui/primitives';
import { Check, ChevronRight, Ellipsis, Folder } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { ServerError, useDeleteMap, useServer, useSetSchedule, useSetScope } from '@/shared/server';

import { messages } from './messages';

/*
 * The map's settings have no window of their own. Before the map exists the scope shows on the empty screen; once it
 * exists, everything used now and then (history, finding more, a new flow, the daily check, the scope, deleting) sits
 * in one "⋯" menu, and the scope editor or the delete confirmation opens as a strip under the header.
 */

/** Folders a map never needs: tooling, dependencies and build output. */
const HIDDEN = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__']);

/**
 * Which folders the map covers (the user's choice), picked from the project's own folders: none picked means the
 * whole project. A folder opens to its subfolders; picking a folder covers everything in it.
 */
export function ScopeEditor({
  cwd,
  board,
  readOnly,
  label,
}: {
  cwd: string;
  board: FlowGetResult;
  readOnly: boolean;
  /** The words in front of what is chosen. */
  label: string;
}) {
  const t = useMessages(messages);
  const scope = useSetScope();
  const include = board.include ?? [];
  const save = (next: string[]) => scope.mutate({ cwd, include: next });
  const toggle = (path: string) => {
    if (include.includes(path)) return save(include.filter((item) => item !== path));
    // A folder covers what is in it: picking it drops its subfolders picked before.
    save([...include.filter((item) => !item.startsWith(`${path}/`)), path]);
  };
  return (
    <section aria-label={t.scopeTitle} className="flex w-80 max-w-full flex-col gap-2 text-left">
      <p className="text-meta text-fg-muted">
        {label} · <span className="text-fg">{include.length ? include.join(', ') : t.scopeAll}</span>
      </p>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-line bg-canvas-raised p-1">
        <FolderList cwd={cwd} path="" include={include} disabled={readOnly || scope.isPending} onToggle={toggle} />
      </div>
      {scope.isError && (
        <p role="alert" className="text-meta text-danger">
          {t.scopeFailed}
        </p>
      )}
    </section>
  );
}

function FolderList({
  cwd,
  path,
  include,
  disabled,
  covered = false,
  onToggle,
}: {
  cwd: string;
  path: string;
  include: string[];
  disabled: boolean;
  /** A folder above is picked: everything here is in already. */
  covered?: boolean;
  onToggle: (path: string) => void;
}) {
  const server = useServer();
  const t = useMessages(messages);
  const listing = useQuery({
    queryKey: ['map-scope-folders', cwd, path],
    queryFn: () => server.request('files/list', { cwd, path, limit: 500 }),
    retry: false,
  });
  const folders = (listing.data?.entries ?? []).filter(
    (entry) => entry.kind === 'directory' && !entry.name.startsWith('.') && !HIDDEN.has(entry.name),
  );
  if (listing.isLoading) return <p className="px-2 py-1 text-meta text-fg-faint">{t.loading}</p>;
  if (!folders.length && !path) return <p className="px-2 py-1 text-meta text-fg-muted">{t.scopeNoFolders}</p>;
  return (
    <ul
      role={path ? 'group' : 'tree'}
      aria-label={path ? undefined : t.scopeTitle}
      className={path ? 'ml-4' : undefined}
    >
      {folders.map((folder) => (
        <FolderRow
          key={folder.path}
          cwd={cwd}
          folder={folder.path}
          name={folder.name}
          include={include}
          disabled={disabled}
          covered={covered}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}

function FolderRow({
  cwd,
  folder,
  name,
  include,
  disabled,
  covered,
  onToggle,
}: {
  cwd: string;
  folder: string;
  name: string;
  include: string[];
  disabled: boolean;
  covered: boolean;
  onToggle: (path: string) => void;
}) {
  const t = useMessages(messages);
  const [open, setOpen] = useState(false);
  const picked = covered || include.includes(folder);
  // Something inside is picked: the folder shows it, so a choice deep down is never lost from sight.
  const partly = !picked && include.some((item) => item.startsWith(`${folder}/`));
  return (
    <li role="treeitem" aria-expanded={open} aria-selected={picked}>
      <div className="flex min-h-7 items-center gap-1 rounded-md px-1 hover:bg-hover">
        <button
          type="button"
          aria-label={open ? t.scopeFold(name) : t.scopeUnfold(name)}
          onClick={() => setOpen(!open)}
          className="flex size-5 shrink-0 cursor-pointer items-center justify-center text-fg-faint hover:text-fg"
        >
          <ChevronRight size={13} aria-hidden className={open ? 'rotate-90' : undefined} />
        </button>
        <label className="flex min-w-0 grow cursor-pointer items-center gap-2 text-body">
          <input
            type="checkbox"
            checked={picked}
            ref={(box) => {
              if (box) box.indeterminate = partly;
            }}
            disabled={disabled || covered}
            onChange={() => onToggle(folder)}
            className="size-3.5 shrink-0 accent-interactive"
          />
          <Folder size={14} aria-hidden className="shrink-0 text-fg-muted" />
          <span className="truncate">{name}</span>
        </label>
      </div>
      {open && (
        <FolderList
          cwd={cwd}
          path={folder}
          include={include}
          disabled={disabled}
          covered={picked}
          onToggle={onToggle}
        />
      )}
    </li>
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
export function DeleteMap({
  cwd,
  onClose,
  onDeleted,
}: {
  cwd: string;
  onClose: () => void;
  /** The map is gone: whatever was about it starts over too. */
  onDeleted?: () => void;
}) {
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
        onClick={() =>
          remove.mutate(
            { cwd },
            {
              onSuccess: () => {
                onDeleted?.();
                onClose();
              },
            },
          )
        }
      >
        {t.deleteMapNow}
      </Button>
      <Button onClick={onClose}>{t.cancel}</Button>
    </section>
  );
}
