import type { ExternalSessionInfo } from '@alpine/protocol';
import { Button, Dialog, LinkButton } from '@alpine/ui/primitives';
import { useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { useImportableSessions, useImportSession } from '@/shared/server';

import { messages } from './messages';

/** How each app that conversations come from is named. A new app is one more entry. */
const APP: Record<ExternalSessionInfo['source'], string> = { claude_code: 'Claude Code', codex: 'Codex' };

/** Up to this many apps are named in the link; more say "other apps", and the list names each. */
const NAMED = 2;

/**
 * The conversations other apps (Claude Code, Codex, …) had in this project, to go on with here: one line saying from
 * where and how many, opening the list. Nothing shows when there are none. Picking one brings it over (its messages,
 * tool calls and results) as a session of the project and opens it; one already brought over, and not added to since,
 * opens again instead of being copied twice.
 */
export function ImportLink({ cwd, onOpen }: { cwd: string; onOpen: (sessionId: string) => void }) {
  const t = useMessages(messages);
  const format = useFormat();
  const found = useImportableSessions(cwd).data ?? [];
  const [open, setOpen] = useState(false);
  if (found.length === 0) return null;
  const apps = [...new Set(found.map((external) => APP[external.source]))];
  const named = apps.length <= NAMED ? t.importApps(apps) : null;

  return (
    <>
      <LinkButton className="self-start px-2 text-body" onClick={() => setOpen(true)}>
        {t.importLink(named, format.number(found.length))} ›
      </LinkButton>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Popup>
          <Dialog.Title>{t.importFrom(named)}</Dialog.Title>
          {open && <ImportList found={found} cwd={cwd} showApp={apps.length > 1} onOpen={onOpen} />}
          <Dialog.Close render={<Button className="self-end" />}>{t.close}</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}

/** The conversations, most recently changed first; the app is named on each when there is more than one. */
function ImportList({
  found,
  cwd,
  showApp,
  onOpen,
}: {
  found: ExternalSessionInfo[];
  cwd: string;
  showApp: boolean;
  onOpen: (sessionId: string) => void;
}) {
  const t = useMessages(messages);
  const format = useFormat();
  const importSession = useImportSession();
  const [picked, setPicked] = useState<string | null>(null);

  const open = async (external: ExternalSessionInfo) => {
    if (external.imported) return onOpen(external.imported);
    setPicked(`${external.source}/${external.id}`);
    try {
      const info = await importSession.mutateAsync({ cwd, source: external.source, id: external.id });
      onOpen(info.id);
    } catch {
      // The error shows under the list.
    } finally {
      setPicked(null);
    }
  };

  return (
    <>
      <ul className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
        {found.map((external) => {
          const key = `${external.source}/${external.id}`;
          return (
            <li key={key}>
              <button
                type="button"
                disabled={importSession.isPending}
                onClick={() => void open(external)}
                className="flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left hover:bg-hover disabled:cursor-default"
              >
                {showApp && <span className="w-22 shrink-0 text-meta text-fg-muted">{APP[external.source]}</span>}
                <span className="min-w-0 grow truncate text-body">{external.title}</span>
                <span className="shrink-0 text-meta whitespace-nowrap text-fg-muted">
                  {picked === key ? t.importing : format.since(new Date(external.updatedAt))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {importSession.isError && (
        <p role="alert" className="text-meta text-danger">
          {t.importFailed(importSession.error.message)}
        </p>
      )}
    </>
  );
}
