import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import type { ServerConnection } from './connection';
import { SessionStore } from './sessionStore';

interface ServerContextValue {
  connection: ServerConnection;
  sessions: SessionStore;
}

const ServerContext = createContext<ServerContextValue | null>(null);

/** Needs a `QueryClientProvider` above it: it keeps the sessions in the query cache. */
export function ServerProvider({ connection, children }: { connection: ServerConnection; children: ReactNode }) {
  const client = useQueryClient();
  const value = useMemo(() => ({ connection, sessions: new SessionStore(connection, client) }), [connection, client]);
  // The one subscription to the server's notifications.
  useEffect(() => value.sessions.start(), [value]);
  return <ServerContext value={value}>{children}</ServerContext>;
}

function useServerContext(): ServerContextValue {
  const value = useContext(ServerContext);
  if (!value) throw new Error('useServer needs a ServerProvider');
  return value;
}

export function useServer(): ServerConnection {
  return useServerContext().connection;
}

/** Keeps sessions fresh from events; the session hooks use it. */
export function useSessionStore(): SessionStore {
  return useServerContext().sessions;
}
