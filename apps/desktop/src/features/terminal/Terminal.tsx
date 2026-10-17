import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { useServer } from '@/shared/server';
import { useStartTerminal, useTerminalOutput, useTerminals } from '@/shared/server/terminals';

import { terminalText } from './display';
import { messages } from './messages';

interface TerminalProps {
  cwd: string;
  sessionId?: string;
  processId?: string | null;
  onSelectProcess?: (processId: string) => void;
}

export function Terminal({ cwd, sessionId, processId, onSelectProcess }: TerminalProps) {
  const server = useServer();
  const t = useMessages(messages);
  const client = useQueryClient();
  const terminals = useTerminals(cwd);
  const start = useStartTerminal(cwd, sessionId);
  const [selected, setSelected] = useState<{ cwd: string; id: string | null }>({
    cwd,
    id: processId ?? client.getQueryData<string>(['terminal-selection', cwd]) ?? null,
  });
  const [command, setCommand] = useState('');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [follow, setFollow] = useState(true);
  const [saving, setSaving] = useState(false);
  const log = useRef<HTMLPreElement>(null);
  const processes = terminals.data?.processes ?? [];
  const remembered = selected.cwd === cwd ? selected.id : client.getQueryData<string>(['terminal-selection', cwd]);
  const activeId = processId ?? remembered ?? processes.at(-1)?.id ?? null;
  const output = useTerminalOutput(activeId);
  const active = processes.find((process) => process.id === activeId) ?? output.data?.process;
  const running = active?.status === 'running';

  useEffect(() => {
    if (follow && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [output.data?.offset, follow]);

  useEffect(() => {
    if (!activeId || !log.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const cols = Math.max(10, Math.floor(entry.contentRect.width / 8));
      const rows = Math.max(2, Math.floor(entry.contentRect.height / 20));
      void server.request('terminals/resize', { processId: activeId, cols, rows }).catch(() => {});
    });
    observer.observe(log.current);
    return () => observer.disconnect();
  }, [server, activeId]);

  const select = (id: string) => {
    setSelected({ cwd, id });
    client.setQueryData(['terminal-selection', cwd], id);
    setFollow(true);
    onSelectProcess?.(id);
  };
  const send = async (data: string) => {
    if (!activeId) return;
    setError('');
    try {
      await server.request('terminals/write', { processId: activeId, data });
      setInput('');
    } catch (cause) {
      setError(String(cause));
    }
  };
  const saveLog = async () => {
    if (!activeId) return;
    setSaving(true);
    setError('');
    try {
      let offset = 0;
      const chunks: string[] = [];
      // Snapshot the extent so a busy process cannot keep this download open forever.
      const total = (await server.request('terminals/read', { processId: activeId, limit: 4 })).total;
      while (offset < total) {
        const page = await server.request('terminals/read', { processId: activeId, offset });
        chunks.push(page.text);
        if (page.nextOffset <= offset) break;
        offset = page.nextOffset;
      }
      const url = URL.createObjectURL(new Blob(chunks, { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `terminal-${activeId}.log`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label={t.title} className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          disabled={start.isPending}
          onClick={() => {
            setError('');
            void start
              .mutateAsync({ command: 'exec "${SHELL:-/bin/sh}" -i', title: t.shell })
              .then((result) => select(result.process.id))
              .catch((cause: unknown) => setError(String(cause)));
          }}
          className="shrink-0 cursor-pointer rounded-lg border border-line px-3 py-2 text-meta text-interactive disabled:opacity-50"
        >
          {t.newTerminal}
        </button>
        <p className="text-meta text-fg-muted">{t.shellHint}</p>
      </div>
      <form
        className="flex shrink-0 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          void start
            .mutateAsync({ command })
            .then((result) => {
              select(result.process.id);
              setCommand('');
            })
            .catch((cause: unknown) => setError(String(cause)));
        }}
      >
        <input
          aria-label={t.command}
          placeholder={t.commandPlaceholder}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          className="min-w-0 grow rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-meta"
        />
        <button
          type="submit"
          disabled={!command.trim() || start.isPending}
          className="cursor-pointer text-meta text-interactive disabled:opacity-50"
        >
          {t.run}
        </button>
      </form>
      <div aria-label={t.processes} className="flex shrink-0 gap-2 overflow-x-auto">
        {processes.map((process) => (
          <button
            key={process.id}
            type="button"
            aria-pressed={process.id === activeId}
            onClick={() => select(process.id)}
            title={`${process.command}\nPID ${process.pid}`}
            className="shrink-0 cursor-pointer rounded-lg border border-line px-3 py-2 text-meta aria-pressed:bg-selected"
          >
            {process.title} · {t[process.status]}
          </button>
        ))}
      </div>
      {!active && <p className="text-body text-fg-muted">{t.empty}</p>}
      {active && (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-3 text-meta text-fg-muted">
            <span className="grow font-mono">
              PID {active.pid} · {t[active.status]}
              {active.exitCode !== null ? ` (${active.exitCode})` : ''}
            </span>
            <button
              type="button"
              onClick={() => setFollow(!follow)}
              aria-pressed={follow}
              className="cursor-pointer text-interactive"
            >
              {follow ? t.following : t.follow}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveLog()}
              className="cursor-pointer text-interactive"
            >
              {t.save}
            </button>
          </div>
          {output.data?.omitted && <p className="text-meta text-fg-muted">{t.omitted}</p>}
          <pre
            ref={log}
            tabIndex={0}
            aria-label={t.output}
            onKeyDown={(event) => {
              if (event.ctrlKey && event.key === 'c' && !window.getSelection()?.toString()) {
                event.preventDefault();
                void send('\x03');
              }
              if (event.ctrlKey && event.key === 'd') {
                event.preventDefault();
                void send('\x04');
              }
            }}
            className="min-h-0 flex-1 overflow-auto rounded-lg border border-line-subtle bg-canvas-raised p-3 font-mono text-meta whitespace-pre-wrap"
          >
            {terminalText(output.data?.text ?? '')}
          </pre>
          <form
            className="flex shrink-0 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send(`${input}\n`);
            }}
          >
            <input
              aria-label={t.input}
              disabled={!running}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={running ? t.inputPlaceholder : t.ended}
              className="min-w-0 grow rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-meta disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!running}
              className="cursor-pointer text-meta text-interactive disabled:opacity-50"
            >
              {t.send}
            </button>
          </form>
        </>
      )}
      {(error || terminals.error || output.error) && (
        <p role="alert" className="text-meta text-danger">
          {error || terminals.error?.message || output.error?.message}
        </p>
      )}
    </section>
  );
}
