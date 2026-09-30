import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type { ServerConnection } from './connection';
import { jsonRpcConnection } from './jsonrpc';

/** The server process the Tauri shell started (see src-tauri/src/server.rs). */
export function tauriConnection(): ServerConnection {
  return jsonRpcConnection({
    send: (line) => invoke('server_send', { line }),
    onLine: (listener) => void listen<string>('server://message', (event) => listener(event.payload)),
  });
}
