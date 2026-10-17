import { Menu } from '@alpine/ui/primitives';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  FileCode2,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useHighlighted } from '@/shared/components/markdown';
import { useFileNavigation } from '@/shared/files';
import { useMessages } from '@/shared/i18n';
import { useServer } from '@/shared/server';

import { FileTree } from './FileTree';
import { messages } from './messages';

export function FileViewer() {
  const navigation = useFileNavigation();
  const server = useServer();
  const client = useQueryClient();
  const t = useMessages(messages);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const selected = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const folders = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const previousPath = useRef<string | undefined>(undefined);
  const location = navigation?.location;
  const selectedPath = location?.path;
  useEffect(() => {
    if (selectedPath) back.current?.focus();
    else if (previousPath.current)
      folders.current?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus();
    previousPath.current = selectedPath;
  }, [selectedPath]);
  const file = useQuery({
    queryKey: ['files', navigation?.cwd, location?.path, location?.line],
    queryFn: () => server.request('files/read', { cwd: navigation!.cwd, path: location!.path, line: location!.line }),
    enabled: Boolean(navigation && location),
    retry: false,
    staleTime: 0,
  });
  const search = useQuery({
    queryKey: ['files-search', navigation?.cwd, query],
    queryFn: () => server.request('files/search', { cwd: navigation!.cwd, query }),
    enabled: Boolean(navigation && query.trim()),
    retry: false,
  });
  useEffect(() => {
    const pane = viewport.current;
    const row = selected.current;
    if (pane && location?.line === undefined) pane.scrollTop = 0;
    else if (pane && row) {
      pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 2;
    }
  }, [file.data, location?.line]);
  const data = file.data;
  const extension = (data?.relativePath ?? location?.path ?? '').split('.').pop() ?? '';
  const language =
    (
      {
        ts: 'typescript',
        tsx: 'tsx',
        js: 'javascript',
        jsx: 'jsx',
        py: 'python',
        rs: 'rust',
        md: 'markdown',
        yml: 'yaml',
        sh: 'bash',
      } as Record<string, string>
    )[extension] ?? extension;
  const tokens = useHighlighted(data?.content ?? '', language, !data);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!navigation) return null;
  const act = async (action: 'editor' | 'reveal') => {
    if (!data) return;
    setActionError('');
    try {
      await server.request('files/action', { cwd: navigation.cwd, path: data.path, line: data.line, action });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t.failure);
    }
  };
  const copyPath = async () => {
    if (!data) return;
    setActionError('');
    try {
      await navigator.clipboard.writeText(data.path);
      setCopied(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t.failure);
    }
  };
  const iconButton =
    'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-hover disabled:cursor-default disabled:opacity-40';
  return (
    <section aria-label={t.title} className="flex min-h-0 grow flex-col gap-3">
      <div
        ref={folders}
        hidden={Boolean(location)}
        className={clsx('min-h-0 grow flex-col gap-2', location ? 'hidden' : 'flex')}
      >
        <div className="flex shrink-0 items-center gap-1">
          <span className="grow text-meta text-fg-muted">{t.localFolder}</span>
          <button
            type="button"
            aria-label={t.search}
            aria-pressed={searchOpen}
            onClick={() => {
              setSearchOpen(!searchOpen);
              setQuery('');
            }}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-hover"
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            aria-label={t.refreshTree}
            onClick={() => void client.invalidateQueries({ queryKey: ['file-tree', navigation.cwd] })}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-hover"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {searchOpen && (
          <input
            aria-label={t.search}
            placeholder={t.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full shrink-0 rounded-lg border border-line bg-canvas px-3 py-2 text-body"
          />
        )}
        {query && (
          <div className="max-h-48 overflow-auto">
            {search.data?.paths.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => {
                  navigation.open({ path });
                  setQuery('');
                }}
                className="block w-full cursor-pointer rounded-sm px-2 py-1 text-left text-meta hover:bg-hover"
              >
                {path}
              </button>
            ))}
            {search.error && (
              <p role="alert" className="text-meta text-danger">
                {search.error.message}
              </p>
            )}
          </div>
        )}
        <div hidden={Boolean(query)} className={clsx('min-h-0 grow flex-col', query ? 'hidden' : 'flex')}>
          <FileTree cwd={navigation.cwd} active={!location && !query} onOpen={(path) => navigation.open({ path })} />
        </div>
      </div>
      {location && (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b border-line-subtle pb-2">
            <button
              ref={back}
              type="button"
              aria-label={location.fromChanges ? t.backToChanges : t.backToTree}
              title={location.fromChanges ? t.backToChanges : t.backToTree}
              onClick={() => {
                navigation.browse();
                setCopied(false);
                setActionError('');
              }}
              className={iconButton}
            >
              <ArrowLeft size={15} />
            </button>
            <FileCode2 size={17} className="ml-1 shrink-0 text-fg-muted" />
            <span title={data?.path ?? location.path} className="min-w-0 grow truncate px-1 text-body font-medium">
              {(data?.relativePath ?? location.path).split('/').pop()}
            </span>
            <button
              type="button"
              aria-label={t.editor}
              title={t.editor}
              disabled={!data}
              onClick={() => void act('editor')}
              className={iconButton}
            >
              <ExternalLink size={16} />
            </button>
            <Menu.Root>
              <Menu.Trigger aria-label={t.actions} title={t.actions} className={iconButton}>
                <MoreHorizontal size={18} />
              </Menu.Trigger>
              <Menu.Popup align="end">
                <Menu.Item disabled={!data} onClick={() => void act('reveal')}>
                  <FolderOpen size={15} />
                  {t.reveal}
                </Menu.Item>
                <Menu.Item disabled={!data} onClick={() => void copyPath()}>
                  <Copy size={15} />
                  {t.copy}
                </Menu.Item>
                <Menu.Separator />
                <Menu.Item onClick={() => void file.refetch()}>
                  <RefreshCw size={15} />
                  {t.refresh}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Root>
          </div>
          {copied && (
            <p role="status" className="flex items-center gap-1 text-meta text-fg-muted">
              <Check size={14} />
              {t.copied}
            </p>
          )}
          {file.isFetching && (
            <p role="status" className="text-meta text-fg-muted">
              {t.loading}
            </p>
          )}
          {(file.error || actionError) && (
            <p role="alert" className="text-body text-danger">
              {file.error?.message ?? actionError}
            </p>
          )}
          {data && (
            <>
              <div
                ref={viewport}
                className="min-h-40 grow overflow-auto bg-canvas py-1 font-mono text-meta whitespace-pre"
              >
                {data.content.split('\n').map((line, index) => {
                  const number = data.startLine + index;
                  return (
                    <div
                      key={number}
                      ref={location.line !== undefined && number === data.line ? selected : undefined}
                      className={clsx(
                        'flex min-w-fit px-2',
                        location.line !== undefined && number === data.line && 'bg-selected',
                      )}
                    >
                      <button
                        type="button"
                        aria-label={`${t.line} ${number}`}
                        onClick={() => navigation.open({ path: data.path, line: number })}
                        className="mr-4 w-12 shrink-0 cursor-pointer text-right text-fg-faint tabular-nums"
                      >
                        {number}
                      </button>
                      <code>
                        {tokens?.[index]
                          ? tokens[index].map((token, tokenIndex) => (
                              <span key={tokenIndex} style={{ color: token.htmlStyle?.color ?? token.color }}>
                                {token.content}
                              </span>
                            ))
                          : line || ' '}
                      </code>
                    </div>
                  );
                })}
              </div>
              {data.truncated && (
                <div className="flex shrink-0 items-center justify-between border-t border-line-subtle pt-2 text-meta text-fg-muted">
                  <button
                    type="button"
                    disabled={data.startLine <= 1}
                    onClick={() => navigation.open({ path: data.path, line: Math.max(1, data.startLine - 200) })}
                    className="cursor-pointer disabled:opacity-40"
                  >
                    {t.previous}
                  </button>
                  <span>
                    {data.startLine}–{Math.min(data.totalLines, data.startLine + data.content.split('\n').length - 1)} /{' '}
                    {data.totalLines}
                  </span>
                  <button
                    type="button"
                    disabled={data.startLine + data.content.split('\n').length > data.totalLines}
                    onClick={() => navigation.open({ path: data.path, line: data.startLine + 400 })}
                    className="cursor-pointer disabled:opacity-40"
                  >
                    {t.next}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
