import type { AgentInfo } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Plus } from 'lucide-react';

import { Character, agentMessages, agentName } from '@/shared/components/agent';
import { useMessages } from '@/shared/i18n';
import { useConnections } from '@/shared/server';

import { agentsMessages } from './messages';

/** The model's own name, without the connection it comes through. */
export function shortModel(model: string) {
  return model.slice(model.indexOf('/') + 1);
}

/** Board 에이전트 화면, the top strip: every agent as a tab (face, name, model and tool count) and 새 에이전트. */
export function AgentStrip({
  agents,
  selected,
  onSelect,
  onNew,
}: {
  agents: AgentInfo[];
  selected: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const t = useMessages(agentsMessages);
  const a = useMessages(agentMessages);
  const defaultModel = useConnections().data?.defaultModel ?? null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle px-4 py-2">
      <div role="tablist" aria-label={t.strip} className="flex min-w-0 grow gap-2 overflow-x-auto">
        {agents.map((agent) => {
          const model = agent.model ?? defaultModel;
          return (
            <button
              key={agent.id}
              type="button"
              role="tab"
              aria-selected={agent.id === selected}
              onClick={() => onSelect(agent.id)}
              className={clsx(
                'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border py-1.5 pr-3 pl-2 text-left',
                agent.id === selected ? 'border-interactive bg-selected' : 'border-transparent hover:bg-hover',
              )}
            >
              <Character look={agent.look} color={agent.color} size={28} label="" />
              <span className="flex min-w-0 flex-col">
                <span className="text-body font-medium">{agentName(agent, a)}</span>
                <span className="text-meta text-fg-muted">
                  {t.stripSummary(model ? shortModel(model) : t.defaultModelShort, agent.tools.length)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <Button className="shrink-0" onClick={onNew}>
        <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
        {t.newAgent}
      </Button>
    </div>
  );
}
