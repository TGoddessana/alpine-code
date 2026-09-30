import { homeDir } from '@tauri-apps/api/path';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { useCallback, useEffect, useState } from 'react';

import { common, useMessages } from '@/shared/i18n';
import { useOpenProject } from '@/shared/server';

const inTauri = () => '__TAURI_INTERNALS__' in window;

/** Asks the OS for a folder (Finder on macOS); `null` when cancelled. A plain browser (`pnpm dev`) asks for a path. */
export async function pickFolder(title: string): Promise<string | null> {
  if (!inTauri()) return window.prompt(title);
  const picked = await open({ directory: true, multiple: false, title });
  return typeof picked === 'string' ? picked : null;
}

/** Shows the folder in Finder. Does nothing in a plain browser. */
export async function revealInFinder(path: string): Promise<void> {
  if (inTauri()) await revealItemInDir(path);
}

/** Opens a web page in the default browser. */
export async function openInBrowser(url: string): Promise<void> {
  if (inTauri()) await openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

/** Calls `listener` with the paths dropped on the window, until the returned function is called. */
export function onPathsDropped(listener: (paths: string[]) => void): () => void {
  if (!inTauri()) return () => {};
  const unlisten = getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'drop') listener(event.payload.paths);
  });
  return () => void unlisten.then((stop) => stop());
}

/** Picks a folder and adds it as a project. Every way in (⌘O, the rail, the empty screen) goes through this. */
export function useOpenFolder(onOpened?: (path: string) => void) {
  const { chooseFolder } = useMessages(common);
  const { mutate } = useOpenProject();
  return useCallback(async () => {
    const path = await pickFolder(chooseFolder);
    if (path) mutate(path, { onSuccess: ({ project }) => onOpened?.(project.path) });
  }, [mutate, chooseFolder, onOpened]);
}

/** The user's home folder, to shorten paths to `~/...`; `null` outside Tauri. */
export function useHomeDir(): string | null {
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    if (inTauri()) void homeDir().then(setHome);
  }, []);
  return home;
}

export function tildePath(path: string, home: string | null): string {
  const base = home?.replace(/\/$/, '');
  return base && (path === base || path.startsWith(`${base}/`)) ? `~${path.slice(base.length)}` : path;
}
