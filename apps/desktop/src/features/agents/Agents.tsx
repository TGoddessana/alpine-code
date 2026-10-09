import type { AgentInfo } from '@alpine/protocol';
import { useCallback, useEffect, useState, type DragEvent } from 'react';

import { Character, agentMessages, agentName } from '@/shared/components/agent';
import { useMessages } from '@/shared/i18n';
import { useAgents, useSaveAgent } from '@/shared/server';

import { AgentHeader, WorkingLine } from './AgentHeader';
import { AgentRows } from './AgentRows';
import { AgentStrip } from './AgentStrip';
import { Library, type DraggedTool, type LibraryView } from './library';
import { agentsMessages } from './messages';
import { NewAgentDialog } from './NewAgentDialog';
import { Toast } from './Toast';

type Search = { agent?: string; create?: true };

const SAVED_MS = 2500;
const FLASH_MS = 1500;

/**
 * Boards 에이전트 화면 and 새 에이전트: the agents along the top, the one being edited on the left (character, name,
 * rows of what it has) and the library of everything the user owns on the right. Every change is saved at once; adding
 * or removing a tool says so in a toast that can take it back. `onChange` writes the route's search.
 */
export function Agents({
  agentId,
  creating,
  onChange,
}: {
  agentId?: string;
  creating: boolean;
  onChange: (search: Search) => void;
}) {
  const agents = useAgents().data?.agents;
  if (!agents) return null;
  const agent = agents.find((a) => a.id === agentId) ?? agents.find((a) => a.id === 'default') ?? agents[0];
  if (!agent) return null;
  const select = (id: string) => onChange(id && id !== 'default' ? { agent: id } : {});

  return (
    <>
      <AgentStrip
        agents={agents}
        selected={agent.id}
        onSelect={select}
        onNew={() => onChange({ ...(agent.id !== 'default' ? { agent: agent.id } : {}), create: true })}
      />
      <Editor key={agent.id} agent={agent} agents={agents} onSelect={select} />
      <NewAgentDialog open={creating} onClose={() => onChange(agentId ? { agent: agentId } : {})} onCreated={select} />
    </>
  );
}

interface ToastState {
  id: number;
  text: string;
  /** The tools before the change, for 되돌리기. */
  previous: string[];
}

/** The agent being edited. Keyed by the agent, so the library view and every flash start fresh with another one. */
function Editor({
  agent,
  agents,
  onSelect,
}: {
  agent: AgentInfo;
  agents: AgentInfo[];
  onSelect: (id: string) => void;
}) {
  const t = useMessages(agentsMessages);
  const a = useMessages(agentMessages);
  const save = useSaveAgent();
  const [view, setView] = useState<LibraryView>({ kind: 'list', tab: 'all' });
  const [dragging, setDragging] = useState<DraggedTool | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const name = agentName(agent, a);

  useEffect(() => {
    if (!savedAt) return;
    const timer = setTimeout(() => setSavedAt(0), SAVED_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);
  const dismiss = useCallback(() => setToast(null), []);

  const persist = (next: AgentInfo) => save.mutate(next, { onSuccess: () => setSavedAt(Date.now()) });

  const change = (tools: string[], text: string, lit: string | null) => {
    setToast({ id: Date.now(), text, previous: agent.tools });
    setFlash(lit);
    persist({ ...agent, tools });
  };
  const add = (tools: string[], label: string) => {
    const fresh = tools.filter((tool) => !agent.tools.includes(tool));
    if (fresh.length > 0) change([...agent.tools, ...fresh], t.toastAdded(label, name), fresh[0] ?? null);
  };
  const remove = (tools: string[], label: string) =>
    change(
      agent.tools.filter((tool) => !tools.includes(tool)),
      t.toastRemoved(label, name),
      null,
    );
  // The server already turned the new tools on; only the telling is left.
  const created = (tools: string[], label: string) => {
    setToast({ id: Date.now(), text: t.toastAdded(label, name), previous: agent.tools });
    setFlash(tools[0] ?? null);
    setSavedAt(Date.now());
  };
  const undo = () => {
    if (toast) persist({ ...agent, tools: toast.previous });
    setToast(null);
  };

  const over = (event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    if (dragging) add([dragging.tool], dragging.label);
    setDragging(null);
  };

  return (
    <div className="flex min-h-0 grow">
      <div className="relative flex min-w-0 grow flex-col">
        <section
          aria-label={t.screen}
          onDragOver={dragging ? over : undefined}
          onDrop={dragging ? drop : undefined}
          className="flex grow flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          <AgentHeader agent={agent} saved={savedAt !== 0} onSave={persist} onSelect={onSelect} />
          <WorkingLine agentId={agent.id} />
          <AgentRows
            agent={agent}
            flash={flash}
            onChange={persist}
            onAdd={add}
            onRemove={remove}
            onOpenTool={(file, tool) => setView({ kind: 'tool', file, tool })}
            onBrowse={(tab) => setView({ kind: 'list', tab })}
            onNewTool={() => setView({ kind: 'new-tool' })}
          />
        </section>
        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-10 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-interactive bg-selected/90">
            <Character look={agent.look} color={agent.color} size={96} label="" />
            <span className="text-title font-medium">{t.drop(dragging.label, name)}</span>
          </div>
        )}
      </div>
      <aside
        aria-label={t.library}
        className="flex w-110 shrink-0 flex-col border-l border-line-subtle bg-canvas-sunken"
      >
        <Library
          agent={agent}
          agents={agents}
          view={view}
          onViewChange={setView}
          onAdd={add}
          onRemove={remove}
          onCreated={created}
          onDragChange={setDragging}
        />
      </aside>
      {toast && <Toast id={toast.id} agent={agent} text={toast.text} onUndo={undo} onDismiss={dismiss} />}
    </div>
  );
}
