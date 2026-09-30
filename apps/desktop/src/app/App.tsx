import { createRouter, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { chatScript, scriptedConnection, tauriConnection, type ServerConnection } from '@/shared/server';

import { Providers } from './providers';
import { routeTree } from './routeTree.gen';

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/** Inside Tauri, the real server. In a plain browser (`pnpm dev`), a scripted server that runs sessions, so screens still render. */
function connect(): ServerConnection {
  if ('__TAURI_INTERNALS__' in window) return tauriConnection();
  return scriptedConnection(chatScript({ stepMs: 400, wordMs: 80 }));
}

export function App() {
  const [connection] = useState(connect);
  return (
    <Providers connection={connection}>
      <RouterProvider router={router} />
    </Providers>
  );
}
