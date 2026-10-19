import { ChevronRight, CloudDownload, FolderOpen, Sparkles, type LucideIcon } from 'lucide-react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

/**
 * The ways a project comes in, one row each: made new from an idea, from a repository, or a folder already on this
 * computer. The project-add dialog and the first screen show the same rows; a new way in is one more row.
 */
export function ProjectChoices({ onNew, onGet, onOpen }: { onNew: () => void; onGet: () => void; onOpen: () => void }) {
  const t = useMessages(messages);
  return (
    <div className="flex flex-col gap-2">
      <Choice icon={Sparkles} title={t.makeNew} hint={t.makeNewHint} end="›" onClick={onNew} />
      <Choice icon={CloudDownload} title={t.getProject} hint={t.getProjectHint} end="›" onClick={onGet} />
      <Choice icon={FolderOpen} title={t.openProject} hint={t.openProjectHint} end="⌘O" onClick={onOpen} />
    </div>
  );
}

function Choice({
  icon: Icon,
  title,
  hint,
  end,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  end: '›' | '⌘O';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-line bg-canvas-raised px-3 py-2.5 text-left hover:bg-hover"
    >
      <Icon size={20} strokeWidth={1.5} className="shrink-0 text-fg-muted" aria-hidden="true" />
      <span className="flex min-w-0 grow flex-col">
        <span className="text-body text-fg">{title}</span>
        <span className="text-meta text-fg-muted">{hint}</span>
      </span>
      {end === '›' ? (
        <ChevronRight size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" aria-hidden="true" />
      ) : (
        <span className="shrink-0 text-meta text-fg-muted">{end}</span>
      )}
    </button>
  );
}
