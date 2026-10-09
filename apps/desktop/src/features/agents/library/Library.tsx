import type { AgentInfo } from '@alpine/protocol';
import { Button, Menu } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Plus } from 'lucide-react';

import { agentMessages, agentName } from '@/shared/components/agent';
import { useFormat, useMessages } from '@/shared/i18n';
import { useTools } from '@/shared/server';

import { cards, type Card } from './cards';
import { libraryMessages } from './messages';
import { NewTool } from './NewTool';
import { statusLine } from './status';
import { ToolDetail } from './ToolDetail';
import type { DraggedTool, LibraryTab, LibraryView } from './types';

export type { DraggedTool, LibraryTab, LibraryView };

const TABS: LibraryTab[] = ['all', 'tool', 'skill', 'mcp', 'sub'];

/**
 * Board 에이전트 화면, the library side: everything the user owns, as cards the agent being edited can pick from.
 * Opening a card replaces the list in place. The library never saves the agent: it reports what was picked
 * (`onAdd`, `onRemove`, `onCreated`) and what is being dragged, and the screen does the saving and the telling.
 */
export function Library({
  agent,
  agents,
  view,
  onViewChange,
  onAdd,
  onRemove,
  onCreated,
  onDragChange,
}: {
  agent: AgentInfo;
  agents: AgentInfo[];
  view: LibraryView;
  onViewChange: (view: LibraryView) => void;
  onAdd: (tools: string[], label: string) => void;
  onRemove: (tools: string[], label: string) => void;
  onCreated: (tools: string[], label: string) => void;
  onDragChange: (item: DraggedTool | null) => void;
}) {
  const t = useMessages(libraryMessages);
  return (
    <aside
      aria-label={t.title}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto border-l border-line bg-canvas"
    >
      {view.kind === 'list' && (
        <List
          agent={agent}
          agents={agents}
          tab={view.tab}
          onViewChange={onViewChange}
          onAdd={onAdd}
          onRemove={onRemove}
          onDragChange={onDragChange}
        />
      )}
      {view.kind === 'tool' && (
        <ToolDetail
          key={view.file}
          agent={agent}
          agents={agents}
          file={view.file}
          tool={view.tool}
          onViewChange={onViewChange}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      )}
      {view.kind === 'new-tool' && <NewTool agent={agent} onViewChange={onViewChange} onCreated={onCreated} />}
    </aside>
  );
}

function List({
  agent,
  agents,
  tab,
  onViewChange,
  onAdd,
  onRemove,
  onDragChange,
}: {
  agent: AgentInfo;
  agents: AgentInfo[];
  tab: LibraryTab;
  onViewChange: (view: LibraryView) => void;
  onAdd: (tools: string[], label: string) => void;
  onRemove: (tools: string[], label: string) => void;
  onDragChange: (item: DraggedTool | null) => void;
}) {
  const t = useMessages(libraryMessages);
  const a = useMessages(agentMessages);
  const tools = useTools().data;
  if (!tools) return null;
  const all = cards(tools, agent, agents, (x) => agentName(x, a));
  const soon = tab === 'skill' || tab === 'mcp' || tab === 'sub' ? tab : null;
  const label = { all: t.tabAll, tool: t.tabTool, skill: t.tabSkill, mcp: t.tabMcp, sub: t.tabSub };
  const newTool = () => onViewChange({ kind: 'new-tool' });

  return (
    <>
      <div className="flex flex-col gap-3 px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <div className="grow">
            <h2 className="text-title">{t.title}</h2>
            <span className="text-meta text-fg-faint">{t.note}</span>
          </div>
          <Menu.Root>
            <Menu.Trigger render={<Button />}>
              <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
              {t.create}
            </Menu.Trigger>
            <Menu.Popup align="end" className="w-68">
              <Menu.Item onClick={newTool}>
                <MenuText title={t.createTool} note={t.createToolNote} />
              </Menu.Item>
              <Menu.Item disabled>
                <MenuText title={t.writeSkill} note={t.writeSkillNote} tag={t.soon} />
              </Menu.Item>
              <Menu.Item disabled>
                <MenuText title={t.connectMcp} note={t.connectMcpNote} tag={t.soon} />
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
        </div>
        <div role="tablist" aria-label={t.tabs} className="flex flex-wrap gap-1">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === tab}
              onClick={() => onViewChange({ kind: 'list', tab: id })}
              className={clsx(
                'min-h-7 cursor-pointer rounded-md px-2.5 text-body',
                id === tab ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-canvas-sunken',
              )}
            >
              {label[id]}
              {(id === 'all' || id === 'tool') && <span className="ml-1 text-fg-faint">{all.length}</span>}
            </button>
          ))}
        </div>
      </div>
      {soon ? (
        <Soon tab={soon} />
      ) : (
        <div className="flex flex-col gap-3 px-5 pb-6">
          {all.length === 0 && <p className="text-body text-fg-muted">{t.empty}</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            <button
              type="button"
              onClick={newTool}
              className="flex min-h-33 cursor-pointer flex-col items-start gap-1.5 rounded-xl border border-dashed border-interactive px-3 pt-2.5 pb-3 text-left hover:bg-canvas-sunken"
            >
              <span className="text-meta text-fg-faint">{t.kindTool}</span>
              <span className="font-medium text-interactive">{t.newCardTitle}</span>
              <span className="text-meta text-fg-muted">{t.newCardBody}</span>
            </button>
            {all.map((card) => (
              <ToolCard
                key={card.tool}
                card={card}
                onOpen={() => onViewChange({ kind: 'tool', file: card.file, tool: card.tool })}
                onAdd={() => onAdd([card.tool], card.label)}
                onRemove={() => onRemove([card.tool], card.label)}
                onDragChange={onDragChange}
              />
            ))}
          </div>
        </div>
      )}
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

function Soon({ tab }: { tab: 'skill' | 'mcp' | 'sub' }) {
  const t = useMessages(libraryMessages);
  const words = {
    skill: [t.skillSoonTitle, t.skillSoonBody],
    mcp: [t.mcpSoonTitle, t.mcpSoonBody],
    sub: [t.subSoonTitle, t.subSoonBody],
  }[tab];
  return (
    <div
      role="tabpanel"
      className="mx-5 mb-5 flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-line p-5"
    >
      <span className="rounded-full bg-canvas-sunken px-2 text-meta text-fg-muted">{t.soon}</span>
      <span className="font-medium">{words[0]}</span>
      <span className="text-meta text-fg-muted">{words[1]}</span>
    </div>
  );
}

function ToolCard({
  card,
  onOpen,
  onAdd,
  onRemove,
  onDragChange,
}: {
  card: Card;
  onOpen: () => void;
  onAdd: () => void;
  onRemove: () => void;
  onDragChange: (item: DraggedTool | null) => void;
}) {
  const t = useMessages(libraryMessages);
  const f = useFormat();
  const ready = card.status === 'ready';
  const draggable = ready && !card.added;
  return (
    <div
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', card.tool);
        event.dataTransfer.effectAllowed = 'copy';
        onDragChange({ tool: card.tool, label: card.label });
      }}
      onDragEnd={() => onDragChange(null)}
      className={clsx(
        'flex min-h-33 flex-col gap-1.5 rounded-xl border border-line px-3 pt-2.5 pb-3',
        card.added ? 'bg-canvas-sunken' : 'bg-canvas-raised',
        draggable && 'cursor-grab',
      )}
    >
      <span className="text-meta text-fg-faint">{t.kindTool}</span>
      <button type="button" onClick={onOpen} className="flex grow cursor-pointer flex-col gap-0.5 text-left">
        <span className={clsx('font-medium', !ready && 'font-mono text-meta')}>
          {ready ? card.label : `${card.file}.py`}
        </span>
        <span className={clsx('text-meta', ready ? 'text-fg-muted' : card.status === 'error' && 'text-danger')}>
          {ready ? card.does : statusLine(card, t, f.since)}
        </span>
        <span className="text-meta text-interactive">{t.openCode}</span>
      </button>
      {ready && card.added && (
        <div className="flex items-center justify-between">
          <span className="text-meta text-interactive">{t.added}</span>
          <Button
            className="min-h-6.5 border-transparent bg-transparent px-2 text-meta text-fg-muted"
            onClick={onRemove}
          >
            {t.remove}
          </Button>
        </div>
      )}
      {ready && !card.added && (
        <Button className="min-h-7 border-interactive text-interactive" onClick={onAdd}>
          {t.add}
        </Button>
      )}
    </div>
  );
}
