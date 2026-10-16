import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

import { inTauri } from './folders';

/**
 * The version downloaded and waiting to be installed, or `null`. A released app downloads a newer version quietly at
 * launch and installs it when it quits; this lets the window offer to restart into it sooner.
 */
export function useUpdateReady(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!inTauri()) return;
    let live = true;
    // Asked as well as listened for: the download can finish before this window starts listening.
    void invoke<string | null>('update_ready').then((ready) => live && ready && setVersion(ready));
    const unlisten = listen<string>('update-ready', (event) => setVersion(event.payload));
    return () => {
      live = false;
      void unlisten.then((stop) => stop());
    };
  }, []);
  return version;
}

export type UpdateCheck = { kind: 'ready'; version: string } | { kind: 'newest' } | { kind: 'failed' };

/** Checks for a newer version now and downloads it; `ready` also sends `update-ready`. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const version = await invoke<string | null>('update_check');
    return version ? { kind: 'ready', version } : { kind: 'newest' };
  } catch {
    return { kind: 'failed' };
  }
}

/** Installs the waiting version and restarts into it. */
export async function restartToUpdate(): Promise<void> {
  await invoke('update_restart');
}
