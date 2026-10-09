import { Menu } from '@alpine/ui/primitives';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';

import { abilities, agentMessages, agentName, Character, shortModel } from '@/shared/components/agent';
import { useMessages } from '@/shared/i18n';
import { useAgents, useConnections } from '@/shared/server';

import { messages } from './messages';

const chip =
  'inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-canvas pr-2 pl-1.5 text-meta whitespace-nowrap text-fg-muted hover:bg-canvas-sunken hover:text-fg data-popup-open:bg-canvas-sunken disabled:cursor-default disabled:opacity-60';

/**
 * The agent doing the work, as a chip in the input bar: its face, name and model. It opens the agents to pick from,
 * each with its model and what its tools let it do, then 새 에이전트 and the settings of this one. `context` says
 * what a pick means: `new` puts it on the session about to start (and marks the one this project used last),
 * `session` hands the running conversation to it. `model` is the model the agent works with now; `disabled` while a
 * run is going, because a swap lands between messages. An agent that is gone (deleted since the session last ran)
 * shows as the default agent, which the session takes up at its next message. If the agents cannot be read the chip
 * says so and stays shut.
 */
export function AgentChip({
  agentId,
  model,
  onChange,
  disabled = false,
  context,
  lastUsed = null,
}: {
  agentId: string;
  model: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  context: 'new' | 'session';
  lastUsed?: string | null;
}) {
  const t = useMessages(messages);
  const a = useMessages(agentMessages);
  const navigate = useNavigate();
  const loaded = useAgents();
  const agents = loaded.data?.agents;
  const defaultModel = useConnections().data?.defaultModel ?? null;
  if (loaded.isError && !agents)
    return (
      <button type="button" disabled className={chip} title={t.chipUnavailable}>
        {t.chipUnavailable}
      </button>
    );
  const current = agents?.find((agent) => agent.id === agentId) ?? agents?.find((agent) => agent.id === 'default');
  if (!agents || !current) return null;
  const shownId = current.id;
  const size = context === 'new' ? 36 : 32;
  return (
    <Menu.Root>
      <Menu.Trigger disabled={disabled} className={chip} aria-label={t.chipLabel(agentName(current, a))}>
        <Character look={current.look} color={current.color} size={22} />
        <span className="text-fg">{agentName(current, a)}</span>
        {model && <span className="text-fg-faint">{shortModel(model)}</span>}
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Popup side="top" align="start" className="w-100">
        <p className="px-2 py-1 text-meta text-fg-muted">{context === 'new' ? t.chipNew : t.chipSession}</p>
        <Menu.RadioGroup value={shownId} onValueChange={(id: string) => id !== shownId && onChange(id)}>
          {agents.map((agent) => {
            const agentModel = agent.model ?? defaultModel;
            return (
              <Menu.RadioItem key={agent.id} value={agent.id}>
                <Character look={agent.look} color={agent.color} size={size} />
                <span className="flex min-w-0 grow flex-col">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate">{agentName(agent, a)}</span>
                    {context === 'new' && agent.id === lastUsed && (
                      <span className="text-meta text-fg-muted">{t.lastUsed}</span>
                    )}
                  </span>
                  <span className="truncate text-meta text-fg-muted">
                    {agentModel ? `${shortModel(agentModel)} · ` : ''}
                    {abilities(agent.tools, a)}
                  </span>
                </span>
              </Menu.RadioItem>
            );
          })}
        </Menu.RadioGroup>
        <Menu.Separator />
        <Menu.Item onClick={() => void navigate({ to: '/agents', search: { create: true } })}>{t.newAgent}</Menu.Item>
        <Menu.Item onClick={() => void navigate({ to: '/agents', search: { agent: shownId } })}>
          {t.agentSettings} ›
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
}
