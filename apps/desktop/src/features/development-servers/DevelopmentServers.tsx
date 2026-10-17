import { Button, Input } from '@alpine/ui/primitives';
import { X } from 'lucide-react';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import {
  useDevelopmentServerActions,
  useDevelopmentServerLogs,
  useDevelopmentServers,
} from '@/shared/server/devServers';

import { messages } from './messages';

/** Server state lives on the backend, so changing sessions never terminates a server. */
export function DevelopmentServers({
  cwd,
  sessionId,
  onDismiss,
}: {
  cwd: string;
  sessionId?: string;
  onDismiss?: () => void;
}) {
  const m = useMessages(messages);
  const servers = useDevelopmentServers(cwd);
  const actions = useDevelopmentServerActions();
  const [command, setCommand] = useState('pnpm dev');
  const [port, setPort] = useState('5173');
  const [selected, setSelected] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const current = servers.data?.servers.find((s) => s.id === selected) ?? servers.data?.servers.at(-1);
  const logs = useDevelopmentServerLogs(current?.id ?? null);
  const conflict = actions.start.data?.conflict;
  const error = servers.error ?? actions.start.error ?? actions.stop.error ?? actions.restart.error ?? logs.error;
  const busy = actions.start.isPending || actions.stop.isPending || actions.restart.isPending;
  const start = async (reuse = false) => {
    const result = await actions.start.mutateAsync({ cwd, command, port: Number(port), sessionId, reuse });
    if (result.server) setSelected(result.server.id);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" aria-label={m.title}>
      <div className="flex items-center justify-between">
        <h2 className="text-body font-medium text-fg">{m.title}</h2>
        {onDismiss && (
          <button
            type="button"
            aria-label={m.dismiss}
            title={m.dismiss}
            onClick={onDismiss}
            className="cursor-pointer text-fg-muted hover:text-fg"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void start().catch(() => {});
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-meta text-fg-muted">
          {m.command}
          <Input
            value={command}
            onChange={(event) => {
              setCommand(event.target.value);
              actions.start.reset();
            }}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-meta text-fg-muted">
          {m.port}
          <Input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => {
              setPort(event.target.value);
              actions.start.reset();
            }}
            required
          />
        </label>
        <Button type="submit" disabled={busy || !command.trim()}>
          {m.start}
        </Button>
      </form>
      {conflict && (
        <div role="alert" className="rounded-lg border border-line bg-canvas-raised p-3 text-body text-fg">
          <p>{m.conflict}</p>
          <p className="text-meta text-fg-muted">
            :{conflict.port} {conflict.cwd}
          </p>
          {conflict.canReuse ? (
            <Button
              disabled={busy}
              onClick={() => {
                void start(true).catch(() => {});
              }}
            >
              {m.reuse}
            </Button>
          ) : (
            <p>{m.unrelated}</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-body text-danger">
          {error.message}
        </p>
      )}
      {servers.isPending && <p className="text-body text-fg-muted">{m.loading}</p>}
      {servers.data?.servers.length === 0 && <p className="text-body text-fg-muted">{m.empty}</p>}
      <div className="flex flex-wrap gap-2">
        {servers.data?.servers.map((server) => (
          <Button key={server.id} onClick={() => setSelected(server.id)} aria-pressed={current?.id === server.id}>
            :{server.port} · {m[server.status]}
          </Button>
        ))}
      </div>
      {current && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-body text-fg">
            <span>
              {current.command} · {m[current.status]}
            </span>
            {(current.status === 'running' || current.status === 'starting' || current.status === 'stopping') && (
              <Button disabled={busy} onClick={() => actions.stop.mutate(current.id)}>
                {current.external ? m.detach : m.stop}
              </Button>
            )}
            {!current.external && (
              <Button
                disabled={busy || current.status === 'stopping'}
                onClick={() => actions.restart.mutate(current.id)}
              >
                {m.restart}
              </Button>
            )}
            {current.url && (
              <>
                <Button
                  onClick={() => {
                    void openInBrowser(current.url!);
                  }}
                >
                  {m.open}
                </Button>
                <Button onClick={() => setShowPreview(!showPreview)} aria-pressed={showPreview}>
                  {m.preview}
                </Button>
              </>
            )}
          </div>
          {showPreview && current.url && (
            <>
              <iframe
                className="min-h-64 flex-1 rounded-lg border border-line bg-canvas"
                src={current.url}
                title={m.preview}
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
              <p className="text-meta text-fg-muted">{m.previewHelp}</p>
            </>
          )}
          <h3 className="text-meta font-medium text-fg">{m.logs}</h3>
          <pre className="min-h-32 overflow-auto rounded-lg border border-line bg-canvas-sunken p-3 font-mono text-meta text-fg whitespace-pre-wrap">
            {current.external ? m.externalLogs : logs.data?.text || m.noLogs}
          </pre>
        </>
      )}
    </section>
  );
}
