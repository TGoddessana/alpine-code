import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

import { useFileNavigation } from '@/shared/files';
import { useMessages } from '@/shared/i18n';
import { useServer } from '@/shared/server';

import { messages } from './messages';

export function FileViewer() {
  const navigation = useFileNavigation();
  const server = useServer();
  const t = useMessages(messages);
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const selected = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const location = navigation?.location;
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
    if (pane && row) {
      pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 2;
    }
  }, [file.data]);
  if (!navigation) return null;
  const data = file.data;
  const act = async (action: 'editor' | 'reveal') => {
    if (!data) return;
    setActionError('');
    try {
      await server.request('files/action', { cwd: navigation.cwd, path: data.path, line: data.line, action });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t.failure);
    }
  };
  return (
    <section aria-label={t.title} className="flex min-h-0 grow flex-col gap-3">
      <input
        aria-label={t.search}
        placeholder={t.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body"
      />
      {query && (
        <div className="max-h-48 overflow-auto">
          {search.data?.paths.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => {
                navigation.open({ path, line: 1 });
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
      {!location && <p className="text-body text-fg-muted">{t.empty}</p>}
      {location && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-meta">
            <span title={data?.path ?? location.path} className="min-w-0 grow truncate font-mono">
              {data?.relativePath ?? location.path}
            </span>
            <button type="button" onClick={() => void file.refetch()} className="cursor-pointer text-interactive">
              {t.refresh}
            </button>
            <button
              type="button"
              disabled={!data}
              onClick={() => void act('editor')}
              className="cursor-pointer text-interactive"
            >
              {t.editor}
            </button>
            <button
              type="button"
              disabled={!data}
              onClick={() => void act('reveal')}
              className="cursor-pointer text-interactive"
            >
              {t.reveal}
            </button>
            <button
              type="button"
              disabled={!data}
              onClick={() => {
                if (data)
                  void navigator.clipboard
                    .writeText(data.path)
                    .then(() => setCopied(true))
                    .catch((error: unknown) => setActionError(String(error)));
              }}
              className="cursor-pointer text-interactive"
            >
              {copied ? t.copied : t.copy}
            </button>
          </div>
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
              <form
                className="flex items-center gap-2 text-meta"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = new FormData(event.currentTarget).get('line');
                  navigation.open({ path: data.path, line: Math.max(1, Number(value) || 1) });
                }}
              >
                <input
                  key={`${data.path}:${data.line}`}
                  name="line"
                  aria-label={t.line}
                  type="number"
                  min={1}
                  max={Math.max(1, data.totalLines)}
                  defaultValue={data.line}
                  className="w-20 rounded-sm border border-line bg-canvas px-2 py-1"
                />
                <button type="submit" className="cursor-pointer text-interactive">
                  ↵
                </button>
                <span className="text-fg-muted">/ {data.totalLines}</span>
                <button
                  type="button"
                  disabled={data.startLine <= 1}
                  onClick={() => navigation.open({ path: data.path, line: Math.max(1, data.startLine - 200) })}
                  className="cursor-pointer text-interactive disabled:text-fg-faint"
                >
                  {t.previous}
                </button>
                <button
                  type="button"
                  disabled={data.startLine + data.content.split('\n').length > data.totalLines}
                  onClick={() => navigation.open({ path: data.path, line: data.startLine + 400 })}
                  className="cursor-pointer text-interactive disabled:text-fg-faint"
                >
                  {t.next}
                </button>
              </form>
              <div
                ref={viewport}
                className="min-h-40 grow overflow-auto rounded-lg border border-line-subtle bg-canvas-raised py-2 font-mono text-meta whitespace-pre"
              >
                {data.content.split('\n').map((line, index) => {
                  const number = data.startLine + index;
                  return (
                    <div
                      key={number}
                      ref={number === data.line ? selected : undefined}
                      className={clsx('flex min-w-fit px-2', number === data.line && 'bg-selected')}
                    >
                      <button
                        type="button"
                        aria-label={`${t.line} ${number}`}
                        onClick={() => navigation.open({ path: data.path, line: number })}
                        className="mr-4 w-12 shrink-0 cursor-pointer text-right text-fg-faint tabular-nums"
                      >
                        {number}
                      </button>
                      <code>{line || ' '}</code>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
