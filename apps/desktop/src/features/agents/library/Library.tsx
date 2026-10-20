import type { AgentInfo } from '@alpine/protocol';
import { Button, Menu } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Plus } from 'lucide-react';

import { useMessages } from '@/shared/i18n';
import { useSkills } from '@/shared/server';

import { libraryMessages } from './messages';
import { NewSkill } from './NewSkill';
import { SkillDetail } from './SkillDetail';
import { Skills } from './Skills';
import type { LibraryTab, LibraryView, SkillActions } from './types';

export type { LibraryTab, LibraryView, SkillActions };

const TABS: LibraryTab[] = ['skill', 'mcp', 'sub'];

/**
 * Board 에이전트 화면, the library side: the skills the agent being edited can use, to find, add, open and write.
 * Opening one replaces the list in place. The library never saves the agent: it reports what changed
 * (`skillActions`), and the screen does the saving and the telling.
 */
export function Library({
  agent,
  agents,
  view,
  onViewChange,
  skillActions,
}: {
  agent: AgentInfo;
  agents: AgentInfo[];
  view: LibraryView;
  onViewChange: (view: LibraryView) => void;
  skillActions: SkillActions;
}) {
  const t = useMessages(libraryMessages);
  return (
    <aside
      aria-label={t.title}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto border-l border-line bg-canvas"
    >
      {view.kind === 'list' && (
        <List agent={agent} tab={view.tab} onViewChange={onViewChange} skillActions={skillActions} />
      )}
      {view.kind === 'skill' && (
        <SkillDetail
          key={view.name}
          agent={agent}
          agents={agents}
          name={view.name}
          onViewChange={onViewChange}
          actions={skillActions}
        />
      )}
      {view.kind === 'new-skill' && <NewSkill onViewChange={onViewChange} actions={skillActions} />}
    </aside>
  );
}

function List({
  agent,
  tab,
  onViewChange,
  skillActions,
}: {
  agent: AgentInfo;
  tab: LibraryTab;
  onViewChange: (view: LibraryView) => void;
  skillActions: SkillActions;
}) {
  const t = useMessages(libraryMessages);
  const skills = useSkills().data?.skills ?? [];
  const soon = tab === 'mcp' || tab === 'sub' ? tab : null;
  const counts: Partial<Record<LibraryTab, number>> = { skill: skills.length };
  const label = { skill: t.tabSkill, mcp: t.tabMcp, sub: t.tabSub };

  return (
    <>
      <div className="flex flex-col gap-3 px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <h2 className="grow text-title">{t.title}</h2>
          <Menu.Root>
            <Menu.Trigger render={<Button />}>
              <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
              {t.create}
            </Menu.Trigger>
            <Menu.Popup align="end" className="w-68">
              <Menu.Item onClick={() => onViewChange({ kind: 'new-skill' })}>
                <MenuText title={t.writeSkill} note={t.writeSkillNote} />
              </Menu.Item>
              <Menu.Item disabled>
                <MenuText title={t.connectMcp} note={t.connectMcpNote} tag={t.soon} />
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
        </div>
        <div role="group" aria-label={t.tabs} className="flex flex-wrap gap-1">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === tab}
              onClick={() => onViewChange({ kind: 'list', tab: id })}
              className={clsx(
                'min-h-7 cursor-pointer rounded-md px-2.5 text-body',
                id === tab ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-canvas-sunken',
              )}
            >
              {label[id]}
              {counts[id] !== undefined && <span className="ml-1 text-fg-faint">{counts[id]}</span>}
            </button>
          ))}
        </div>
      </div>
      {soon ? <Soon tab={soon} /> : <Skills agent={agent} onViewChange={onViewChange} actions={skillActions} />}
    </>
  );
}

function MenuText({ title, note, tag }: { title: string; note: string; tag?: string }) {
  return (
    <span className="flex min-w-0 grow flex-col py-1">
      <span className="flex justify-between gap-2">
        <span>{title}</span>
        {tag && <span className="text-meta text-fg-muted">{tag}</span>}
      </span>
      <span className="text-meta text-fg-muted">{note}</span>
    </span>
  );
}

function Soon({ tab }: { tab: 'mcp' | 'sub' }) {
  const t = useMessages(libraryMessages);
  const words = {
    mcp: [t.mcpSoonTitle, t.mcpSoonBody],
    sub: [t.subSoonTitle, t.subSoonBody],
  }[tab];
  return (
    <div className="mx-5 mb-5 flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-line p-5">
      <span className="rounded-full bg-canvas-sunken px-2 text-meta text-fg-muted">{t.soon}</span>
      <span className="font-medium">{words[0]}</span>
      <span className="text-meta text-fg-muted">{words[1]}</span>
    </div>
  );
}
