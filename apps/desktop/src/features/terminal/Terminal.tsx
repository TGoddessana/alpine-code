import type { TerminalProcess } from '@alpine/protocol';
import { Menu } from '@alpine/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ChevronDown,
  Columns2,
  Download,
  Eraser,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  TerminalSquare,
  Globe,
  Trash2,
  X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { useServer } from '@/shared/server';
import { useStartTerminal, useTerminals } from '@/shared/server/terminals';

import { messages } from './messages';

const TerminalScreen = lazy(() => import('./TerminalScreen'));
const noProcesses: TerminalProcess[] = [];
const iconButton =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-hover disabled:cursor-default disabled:opacity-40';
interface TerminalProps {
  cwd: string;
  sessionId?: string;
  processId?: string | null;
  onSelectProcess?: (processId: string) => void;
  onOpenDevelopmentServer?: () => void;
}

export function Terminal({ cwd, sessionId, processId, onSelectProcess, onOpenDevelopmentServer }: TerminalProps) {
  const server = useServer();
  const t = useMessages(messages);
  const client = useQueryClient();
  const terminals = useTerminals(cwd);
  const start = useStartTerminal(cwd, sessionId);
  const root = useRef<HTMLElement>(null);
  const closing = useRef(new Set<string>());
  const initialised = useRef(false);
  const [selected, setSelected] = useState<string | null>(
    () => processId ?? client.getQueryData<string>(['terminal-selection', cwd]) ?? null,
  );
  const [split, setSplit] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const processes = terminals.data?.processes ?? noProcesses;
  const active = processes.find((process) => process.id === (processId ?? selected)) ?? processes.at(-1);
  const secondary = processes.find((process) => process.id === split && process.id !== active?.id);
  const background = processes.filter((process) => process.id !== active?.id && process.id !== secondary?.id);
  const target = processes.find((process) => process.id === focusedId) ?? active;
  const select = (id: string) => {
    setFocusedId(id);
    if (id === active?.id || id === secondary?.id) {
      requestAnimationFrame(() => {
        const pane = [...(root.current?.querySelectorAll<HTMLElement>('[data-terminal-id]') ?? [])].find(
          (element) => element.dataset.terminalId === id,
        );
        pane?.querySelector('textarea')?.focus();
      });
    } else if (secondary && target?.id === secondary.id) {
      setSplit(id);
    } else {
      setSelected(id);
    }
    client.setQueryData(['terminal-selection', cwd], id);
    setError('');
    onSelectProcess?.(id);
  };
  const create = async (asSplit = false, defaultShell = false) => {
    initialised.current = true;
    setError('');
    try {
      if (asSplit && active) setSelected(active.id);
      const nextNumber =
        Math.max(
          0,
          ...processes.map((process) =>
            process.title.startsWith(`${t.shell} `) ? Number(process.title.slice(t.shell.length + 1)) || 0 : 0,
          ),
        ) + 1;
      const result = await start.mutateAsync({
        command: 'exec "${SHELL:-/bin/sh}" -i',
        title: `${t.shell} ${nextNumber}`,
        kind: 'shell',
        defaultShell,
      });
      if (asSplit && active) setSplit(result.process.id);
      else select(result.process.id);
    } catch (cause) {
      setError(String(cause));
    }
  };
  const initialise = useEffectEvent(() => {
    if (initialised.current) return;
    initialised.current = true;
    const requested = processes.find((process) => process.id === (processId ?? selected));
    if (requested && requested.kind !== 'shell') return;
    const shell = processes.find((process) => process.kind === 'shell' && process.status === 'running');
    if (shell) select(requested?.status === 'running' ? requested.id : shell.id);
    else void create(false, true);
  });
  useEffect(() => {
    // Decide once per tab opening, after a fresh list. Exiting the final shell
    // must still close it instead of immediately creating another one.
    if (!terminals.isFetchedAfterMount || !terminals.isSuccess || terminals.isFetching) return;
    const timer = setTimeout(() => initialise(), 0);
    return () => clearTimeout(timer);
  }, [terminals.isFetchedAfterMount, terminals.isSuccess, terminals.isFetching]);
  const close = useCallback(
    async (id: string) => {
      if (closing.current.has(id)) return;
      closing.current.add(id);
      setBusy(true);
      setError('');
      try {
        await server.request('terminals/close', { processId: id });
        client.setQueryData<{ processes: TerminalProcess[] }>(['terminals', cwd], (current) => ({
          processes: (current?.processes ?? []).filter((process) => process.id !== id),
        }));
        if (split === id) setSplit(null);
        if (active?.id === id) {
          const nextId = secondary?.id ?? processes.filter((process) => process.id !== id).at(-1)?.id ?? null;
          setSelected(nextId);
          setSplit(null);
          client.setQueryData(['terminal-selection', cwd], nextId);
        }
        if (active?.id === id || secondary?.id === id) {
          const nextId =
            active?.id === id
              ? (secondary?.id ?? processes.filter((process) => process.id !== id).at(-1)?.id)
              : active?.id;
          setFocusedId(nextId ?? null);
          requestAnimationFrame(() => {
            const pane = [...(root.current?.querySelectorAll<HTMLElement>('[data-terminal-id]') ?? [])].find(
              (element) => element.dataset.terminalId === nextId,
            );
            pane?.querySelector('textarea')?.focus();
          });
        }
        await client.invalidateQueries({ queryKey: ['terminals', cwd] });
        const { disposeTerminal } = await import('./runtime');
        disposeTerminal(server, id);
      } catch (cause) {
        setError(String(cause));
      } finally {
        closing.current.delete(id);
        setBusy(closing.current.size > 0);
      }
    },
    [server, client, cwd, processes, split, active, secondary, setError],
  );
  useEffect(() => {
    const ended = processes.filter(
      (process) => process.kind === 'shell' && !['running', 'stopping'].includes(process.status),
    );
    if (!ended.length) return;
    const timer = setTimeout(() => {
      for (const process of ended) void close(process.id);
    }, 0);
    return () => clearTimeout(timer);
  }, [processes, close]);
  const saveLog = async () => {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      let offset = 0;
      const chunks: string[] = [];
      const total = (await server.request('terminals/read', { processId: target.id, limit: 4 })).total;
      while (offset < total) {
        const page = await server.request('terminals/read', { processId: target.id, offset });
        chunks.push(page.text);
        if (page.nextOffset <= offset) break;
        offset = page.nextOffset;
      }
      const url = URL.createObjectURL(new Blob(chunks, { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `terminal-${target.id}.log`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const pane = (process: TerminalProcess) => (
    <div
      key={process.id}
      data-terminal-id={process.id}
      onFocusCapture={() => setFocusedId(process.id)}
      className="flex min-h-0 min-w-0 grow basis-0 flex-col"
    >
      {secondary && (
        <div
          className={clsx(
            'flex h-7 shrink-0 items-center gap-2 border-b border-l-2 border-line-subtle px-2 text-meta',
            target?.id === process.id ? 'border-l-interactive text-fg' : 'border-l-transparent text-fg-muted',
          )}
        >
          <button
            type="button"
            onClick={(event) => event.currentTarget.closest('[data-terminal-id]')?.querySelector('textarea')?.focus()}
            className="min-w-0 grow cursor-pointer truncate text-left"
          >
            {process.title}
          </button>
          <button
            type="button"
            title={t.close}
            aria-label={`${t.close}: ${process.title}`}
            disabled={busy}
            onClick={() => void close(process.id)}
            className={iconButton}
          >
            <X size={13} />
          </button>
        </div>
      )}
      <Suspense fallback={<LoaderCircle size={16} className="m-3 animate-spin text-fg-muted" />}>
        <TerminalScreen
          key={`${process.id}:${epoch}`}
          processId={process.id}
          label={`${t.input}: ${process.title}`}
          onError={setError}
        />
      </Suspense>
      {process.status !== 'running' && (
        <p className="shrink-0 px-3 py-1 text-meta text-fg-muted">
          {t[process.status]}
          {process.exitCode !== null ? ` (${process.exitCode})` : ''}
        </p>
      )}
    </div>
  );

  return (
    <section ref={root} aria-label={t.title} className="@container flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line-subtle px-2">
        <div className="flex min-w-0 grow items-center">
          {background.length > 0 ? (
            <Menu.Root>
              <Menu.Trigger
                aria-label={t.processes}
                title={t.processes}
                className="flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-meta text-fg-muted hover:bg-hover"
              >
                <TerminalSquare size={14} className="shrink-0" />
                <span className="truncate">
                  {t.processes} ({background.length})
                </span>
                <ChevronDown size={12} className="shrink-0" />
              </Menu.Trigger>
              <Menu.Popup>
                {background.map((process) => (
                  <Menu.Item
                    key={process.id}
                    onClick={() => select(process.id)}
                    title={`${process.command} · PID ${process.pid}`}
                  >
                    <TerminalSquare size={14} aria-hidden="true" className="shrink-0" />
                    <span className="truncate">{process.title}</span>
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Root>
          ) : (
            <span className="truncate px-2 text-meta text-fg-muted">
              {secondary ? t.title : (active?.title ?? t.title)}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={t.newTerminal}
          title={t.newTerminal}
          disabled={start.isPending}
          onClick={() => void create()}
          className={iconButton}
        >
          {start.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={16} />}
        </button>
        <button
          type="button"
          aria-label={t.split}
          title={t.split}
          disabled={!active || start.isPending || Boolean(secondary)}
          onClick={() => void create(true)}
          className={iconButton}
        >
          <Columns2 size={15} />
        </button>
        <button
          type="button"
          aria-label={t.close}
          title={t.close}
          disabled={!target || busy}
          onClick={() => target && void close(target.id)}
          className={iconButton}
        >
          <Trash2 size={15} />
        </button>
        <Menu.Root>
          <Menu.Trigger aria-label={t.actions} title={t.actions} className={iconButton}>
            <MoreHorizontal size={17} />
          </Menu.Trigger>
          <Menu.Popup align="end">
            {onOpenDevelopmentServer && (
              <Menu.Item onClick={onOpenDevelopmentServer}>
                <Globe size={15} />
                {t.developmentServer}
              </Menu.Item>
            )}
            <Menu.Item
              disabled={!target}
              onClick={() => {
                if (target)
                  void import('./runtime').then(({ terminalRuntime }) => terminalRuntime(server, target.id).clear());
              }}
            >
              <Eraser size={15} />
              {t.clear}
            </Menu.Item>
            <Menu.Item disabled={!target || busy} onClick={() => void saveLog()}>
              <Download size={15} />
              {t.save}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      </div>
      {active ? (
        <div className="flex min-h-0 grow flex-col divide-y divide-line-subtle @min-xl:flex-row @min-xl:divide-x @min-xl:divide-y-0">
          {pane(active)}
          {secondary && pane(secondary)}
        </div>
      ) : (
        <div className="flex min-h-0 grow items-center justify-center">
          <button
            type="button"
            disabled={start.isPending || terminals.isPending}
            onClick={() => void create()}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-meta text-fg-muted hover:bg-hover"
          >
            <Plus size={15} />
            {t.newTerminal}
          </button>
        </div>
      )}
      {(error || terminals.error) && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-t border-line-subtle px-3 py-2 text-meta text-danger"
        >
          <span className="min-w-0 grow">{error || terminals.error?.message}</span>
          <button
            type="button"
            onClick={() => {
              initialised.current = false;
              setError('');
              setEpoch((value) => value + 1);
              void terminals.refetch();
            }}
            className="cursor-pointer text-interactive"
          >
            {t.retry}
          </button>
        </div>
      )}
    </section>
  );
}
