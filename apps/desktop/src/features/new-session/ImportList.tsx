import type { ExternalSessionInfo } from '@alpine/protocol';
import { LinkButton } from '@alpine/ui/primitives';
import { useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { useImportableSessions, useImportSession } from '@/shared/server';

import { messages } from './messages';

const SHOWN = 3;
const APP = { claude_code: 'Claude Code', codex: 'Codex' } as const;

/**
 * The conversations Claude Code and Codex had in this project, to go on with here. Nothing shows when there are none.
 * Picking one brings it over (its messages, tool calls and results) as a session of the project and opens it; one
 * already brought over, and not added to since, opens again instead of being copied twice.
 */
export function ImportList({ cwd, onOpen }: { cwd: string; onOpen: (sessionId: string) => void }) {
  const t = useMessages(messages);
  const format = useFormat();
  const found = useImportableSessions(cwd).data ?? [];
  const importSession = useImportSession();
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  if (found.length === 0) return null;
  const shown = all ? found : found.slice(0, SHOWN);

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
    <section aria-labelledby="import-heading" className="flex w-full flex-col gap-1">
      <h2 id="import-heading" className="px-2 text-meta text-fg-muted">
        {t.importHeading}
      </h2>
      <ul className={all ? 'flex max-h-64 flex-col overflow-y-auto' : 'flex flex-col'}>
        {shown.map((external) => {
          const key = `${external.source}/${external.id}`;
          return (
            <li key={key}>
              <button
                type="button"
                disabled={importSession.isPending}
                onClick={() => void open(external)}
                className="flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left hover:bg-hover disabled:cursor-default"
              >
                <span className="w-22 shrink-0 text-meta text-fg-muted">{APP[external.source]}</span>
                <span className="min-w-0 grow truncate text-body">{external.title}</span>
                <span className="shrink-0 text-meta whitespace-nowrap text-fg-muted">
                  {picked === key ? t.importing : format.since(new Date(external.updatedAt))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!all && found.length > SHOWN && (
        <LinkButton className="ml-2 w-fit" onClick={() => setAll(true)}>
          {t.importShowAll(format.number(found.length))}
        </LinkButton>
      )}
      {importSession.isError && (
        <p role="alert" className="px-2 text-meta text-danger">
          {t.importFailed(importSession.error.message)}
        </p>
      )}
    </section>
  );
}
