import { ChevronRight } from 'lucide-react';

import { useFormat, useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { useWorkResult } from './useWorkResult';

/** 요약 for a session: how much the work touched; each line opens the changes, where it is shown. */
export function WorkSummary({ sessionId, onOpenChanges }: { sessionId: string; onOpenChanges: () => void }) {
  const t = useMessages(messages);
  const format = useFormat();
  const result = useWorkResult(sessionId);
  const files = result?.files.length ?? 0;
  const commands = result?.commands.length ?? 0;
  if (!files && !commands) return <p className="px-5 text-body text-fg-muted">{t.nothingYet}</p>;
  const row = 'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-body hover:bg-hover';
  return (
    <div className="flex flex-col px-3">
      {files > 0 && (
        <button type="button" className={row} onClick={onOpenChanges}>
          <span className="grow text-left">{t.files}</span>
          <span className="text-fg-muted tabular-nums">{t.count(format.number(files))}</span>
          <ChevronRight size={14} aria-hidden className="text-fg-faint" />
        </button>
      )}
      {commands > 0 && (
        <button type="button" className={row} onClick={onOpenChanges}>
          <span className="grow text-left">{t.commands}</span>
          <span className="text-fg-muted tabular-nums">{t.count(format.number(commands))}</span>
          <ChevronRight size={14} aria-hidden className="text-fg-faint" />
        </button>
      )}
    </div>
  );
}
