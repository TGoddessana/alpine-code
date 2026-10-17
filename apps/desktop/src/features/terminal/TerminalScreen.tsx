import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useServer } from '@/shared/server';

import { loadTerminalFonts } from './fonts';
import { terminalRuntime } from './runtime';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

export default function TerminalScreen({
  processId,
  label,
  onError,
}: {
  processId: string;
  label: string;
  onError: (error: string) => void;
}) {
  const server = useServer();
  const client = useQueryClient();
  const host = useRef<HTMLDivElement>(null);
  const error = useRef(onError);
  useEffect(() => {
    error.current = onError;
  }, [onError]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    let detach: (() => void) | undefined;
    void loadTerminalFonts()
      .then(() => {
        if (cancelled) return;
        detach = terminalRuntime(server, processId).attach(
          element,
          label,
          (message) => error.current(message),
          () => void client.invalidateQueries({ queryKey: ['terminals'] }),
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) error.current(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, [server, processId, label, client]);
  return <div ref={host} role="group" aria-label={label} className="h-full min-h-0 min-w-0 grow overflow-hidden p-2" />;
}
