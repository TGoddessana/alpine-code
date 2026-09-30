import { createContext, useContext, type ReactNode } from 'react';

import type { ServerConnection } from './connection';

const ServerContext = createContext<ServerConnection | null>(null);

export function ServerProvider({ connection, children }: { connection: ServerConnection; children: ReactNode }) {
  return <ServerContext value={connection}>{children}</ServerContext>;
}

export function useServer(): ServerConnection {
  const connection = useContext(ServerContext);
  if (!connection) throw new Error('useServer needs a ServerProvider');
  return connection;
}
