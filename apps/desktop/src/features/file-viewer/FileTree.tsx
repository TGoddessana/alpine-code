import type { FileEntry } from '@alpine/protocol';
import { useInfiniteQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronRight, FileCode2, FileText, Folder, FolderOpen, Link2 } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { useMessages } from '@/shared/i18n';
import { useServer } from '@/shared/server';

import { messages } from './messages';

/** Directories load only when expanded. Keep this mounted while viewing a file to preserve expansion and focus. */
export function FileTree({ cwd, active, onOpen }: { cwd: string; active: boolean; onOpen: (path: string) => void }) {
  const t = useMessages(messages);
  const tree = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState(() => new Set(['']));
  const [focused, setFocused] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const choose = (path: string, kind: FileEntry['kind']) => {
    if (kind === 'directory') {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    } else if (kind === 'file') {
      setChosen(path);
      onOpen(path);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!element || !tree.current) return;
    const rows = [...tree.current.querySelectorAll<HTMLElement>('[role="treeitem"]')].filter(
      (row) => row.getAttribute('aria-disabled') !== 'true',
    );
    const index = rows.indexOf(element);
    const path = element.dataset.path!;
    let next: HTMLElement | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = rows[Math.min(index + 1, rows.length - 1)];
        break;
      case 'ArrowUp':
        next = rows[Math.max(index - 1, 0)];
        break;
      case 'Home':
        next = rows[0];
        break;
      case 'End':
        next = rows.at(-1);
        break;
      case 'ArrowRight':
        if (element.getAttribute('aria-expanded') === 'false') choose(path, 'directory');
        else if (element.getAttribute('aria-expanded') === 'true' && rows[index + 1]?.dataset.parent === path)
          next = rows[index + 1];
        break;
      case 'ArrowLeft':
        if (element.getAttribute('aria-expanded') === 'true') choose(path, 'directory');
        else next = rows.find((row) => row.dataset.path === element.dataset.parent);
        break;
      case 'Enter':
      case ' ':
        choose(path, element.dataset.kind as FileEntry['kind']);
        break;
      default:
        return;
    }
    event.preventDefault();
    next?.focus();
  };
  const row = (entry: FileEntry, parent: string | undefined, level: number) => {
    const directory = entry.kind === 'directory';
    const open = directory && expanded.has(entry.path);
    const linked = entry.kind === 'symlink';
    const Icon = directory
      ? open
        ? FolderOpen
        : Folder
      : linked
        ? Link2
        : /\.(tsx?|jsx?|py|json|css|html|rs|toml)$/.test(entry.name)
          ? FileCode2
          : FileText;
    return (
      <li
        key={entry.path}
        role="treeitem"
        aria-label={entry.name}
        aria-level={level}
        aria-expanded={directory ? open : undefined}
        aria-selected={!directory ? chosen === entry.path : undefined}
        aria-disabled={linked || undefined}
        tabIndex={focused === entry.path && !linked ? 0 : -1}
        data-path={entry.path}
        data-parent={parent}
        data-kind={entry.kind}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setFocused(entry.path);
        }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (linked || target.closest('[role="treeitem"]') !== event.currentTarget || target.closest('button')) return;
          event.currentTarget.focus();
          choose(entry.path, entry.kind);
        }}
        className="outline-none [&:focus-visible>div]:ring-2 [&:focus-visible>div]:ring-interactive"
      >
        <div
          title={linked ? t.symlink : entry.path || cwd}
          className={clsx(
            'flex min-h-8 items-center gap-2 rounded-md px-2 text-body',
            linked ? 'text-fg-faint' : 'cursor-pointer text-fg hover:bg-hover',
            !directory && chosen === entry.path && 'bg-selected',
          )}
        >
          {directory ? (
            <ChevronRight
              size={13}
              aria-hidden="true"
              className={clsx('shrink-0 text-fg-faint', open && 'rotate-90')}
            />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <Icon
            size={15}
            aria-hidden="true"
            className={clsx('shrink-0', directory ? 'text-interactive' : 'text-fg-faint')}
          />
          <span className="truncate">{entry.name}</span>
        </div>
        {open && (
          <DirectoryContents
            cwd={cwd}
            path={entry.path}
            active={active}
            renderEntry={(child) => row(child, entry.path, level + 1)}
          />
        )}
      </li>
    );
  };
  return (
    <ul ref={tree} role="tree" aria-label={t.tree} onKeyDown={onKeyDown} className="min-h-0 grow overflow-auto py-1">
      {row({ name: cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd, path: '', kind: 'directory' }, undefined, 1)}
    </ul>
  );
}

function DirectoryContents({
  cwd,
  path,
  active,
  renderEntry,
}: {
  cwd: string;
  path: string;
  active: boolean;
  renderEntry: (entry: FileEntry) => ReactNode;
}) {
  const server = useServer();
  const t = useMessages(messages);
  const listing = useInfiniteQuery({
    queryKey: ['file-tree', cwd, path],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => server.request('files/list', { cwd, path, offset: pageParam }),
    getNextPageParam: (last) => (last.hasMore ? last.nextOffset : undefined),
    enabled: active,
    retry: false,
  });
  return (
    <ul role="group" className="ml-3 border-l border-line-subtle pl-1">
      {listing.isPending && active && (
        <li role="none" className="px-5 py-1 text-meta text-fg-faint">
          {t.folderLoading}
        </li>
      )}
      {listing.error && (
        <li role="none" className="px-5 py-1 text-meta">
          <p role="alert" className="text-danger">
            {t.folderError}
          </p>
          <button type="button" onClick={() => void listing.refetch()} className="cursor-pointer text-interactive">
            {t.retry}
          </button>
        </li>
      )}
      {listing.data?.pages.flatMap((page) => page.entries).map(renderEntry)}
      {listing.data?.pages[0]?.entries.length === 0 && (
        <li role="none" className="px-5 py-1 text-meta text-fg-faint">
          {t.folderEmpty}
        </li>
      )}
      {listing.hasNextPage && (
        <li role="none">
          <button
            type="button"
            disabled={listing.isFetchingNextPage}
            onClick={() => void listing.fetchNextPage()}
            className="cursor-pointer px-5 py-1 text-meta text-interactive"
          >
            {t.more}
          </button>
        </li>
      )}
    </ul>
  );
}
