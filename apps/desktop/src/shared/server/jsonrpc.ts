import type { ErrorData, Response } from '@alpine/protocol';

import { ServerError, type Notification, type ServerConnection } from './connection';

interface Transport {
  send(line: string): Promise<void>;
  onLine(listener: (line: string) => void): void;
}

/** JSON-RPC 2.0 over a line transport: numbers requests, matches responses, fans out notifications. */
export function jsonRpcConnection(transport: Transport): ServerConnection {
  let nextId = 1;
  const pending = new Map<number, { resolve: (result: never) => void; reject: (error: Error) => void }>();
  const listeners = new Set<(notification: Notification) => void>();

  transport.onLine((line) => {
    const message = JSON.parse(line) as Response & Notification;
    if (typeof message.id === 'number' && pending.has(message.id)) {
      const request = pending.get(message.id)!;
      pending.delete(message.id);
      if (message.error)
        request.reject(
          new ServerError(message.error.code, message.error.message, message.error.data as ErrorData | undefined),
        );
      else request.resolve(message.result as never);
    } else if (message.method) {
      listeners.forEach((listener) => listener({ method: message.method, params: message.params }));
    }
  });

  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        transport.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })).catch((error: unknown) => {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
