import type { TaskForceItem } from '@alpine/protocol';
import { Button, LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { useMemo, type ReactNode } from 'react';

import { Character } from '@/shared/components/agent';
import {
  roomOf,
  taskForceMessages as messages,
  useStatus,
  Workshop,
  type RoomAgent,
} from '@/shared/components/taskforce';
import { useMessages } from '@/shared/i18n';
import { useStopTaskForceAgent, useTaskForceRecord, type Item } from '@/shared/server';

/**
 * The dock's TF tab (decision 6): the room large, with names, then one row per agent by step. A hare or a row opens
 * what that agent did, read-only, drawn as the chat draws calls, with 이 에이전트만 멈추기 while it works.
 */
export function AgentsTab({
  sessionId,
  item,
  selected,
  onSelect,
  renderRecord,
}: {
  sessionId: string;
  item: TaskForceItem;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Draws what one agent did, as the session draws items. */
  renderRecord: (items: Item[]) => ReactNode;
}) {
  const t = useMessages(messages);
  const room = useMemo(() => roomOf(item), [item]);
  const agent = room.agents.find((a) => a.id === selected);
  return (
    <div className="flex flex-col gap-4 p-4">
      <Workshop room={room} size={36} selected={selected} onSelect={item.members.length ? onSelect : undefined} />
      {agent ? (
        <Record
          sessionId={sessionId}
          runId={item.id}
          agent={agent}
          onBack={() => onSelect(null)}
          renderRecord={renderRecord}
        />
      ) : (
        <>
          {item.members.length > 0 && <p className="text-meta text-fg-faint">{t.pickHint}</p>}
          {room.steps.map((step, i) => {
            const agents = room.agents.filter((a) => a.phase === i && a.task !== '');
            if (!agents.length) return null;
            return (
              <section key={`${i}-${step.title}`} className="flex flex-col">
                <h3 className="mb-1 text-meta text-fg-muted">
                  {step.title}
                  {step.model && ` · ${step.model}`}
                </h3>
                {agents.map((a) => (
                  <Row key={a.id} agent={a} onSelect={onSelect} />
                ))}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function Row({ agent, onSelect }: { agent: RoomAgent; onSelect: (id: string) => void }) {
  const t = useMessages(messages);
  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      className={clsx(
        'flex cursor-pointer items-center gap-2 border-t border-line-subtle py-1.5 text-left text-body hover:bg-hover',
        agent.state === 'queued' && 'text-fg-muted',
      )}
    >
      <Character look={agent.look} color={agent.color} size={22} label="" />
      <span className="min-w-0 truncate">{agent.task}</span>
      {agent.agent && <span className="shrink-0 text-meta text-fg-faint">{agent.agent}</span>}
      <span className="grow" />
      {agent.cached && <span className="shrink-0 text-meta text-fg-faint">{t.cached}</span>}
      <Status agent={agent} />
    </button>
  );
}

function Status({ agent }: { agent: RoomAgent }) {
  const t = useMessages(messages);
  const status = useStatus(agent);
  const tone =
    agent.state === 'working'
      ? 'text-interactive'
      : agent.state === 'asking'
        ? 'text-attention'
        : agent.state === 'queued'
          ? 'text-fg-faint'
          : agent.state === 'failed'
            ? 'text-danger'
            : 'text-fg-muted';
  return (
    <span className={clsx('shrink-0 text-meta', tone)}>
      {status}
      {agent.state === 'working' && agent.turn ? ` · ${t.turn(agent.turn)}` : ''}
    </span>
  );
}

function Record({
  sessionId,
  runId,
  agent,
  onBack,
  renderRecord,
}: {
  sessionId: string;
  runId: string;
  agent: RoomAgent;
  onBack: () => void;
  renderRecord: (items: Item[]) => ReactNode;
}) {
  const t = useMessages(messages);
  const stop = useStopTaskForceAgent();
  const params = agent.task ? { sessionId, runId, memberId: agent.id } : null;
  // Fetched again as the agent goes on: each turn and each change of what it does.
  const record = useTaskForceRecord(
    params,
    (agent.turn ?? 0) * 10 + (agent.activity?.length ?? 0) + agent.state.length,
  );
  const items = record.data ?? [];
  const working = agent.state === 'working' || agent.state === 'asking' || agent.state === 'queued';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <LinkButton onClick={onBack}>{t.back}</LinkButton>
        <span className="grow" />
        <span className="text-meta text-fg-faint">{t.readOnly}</span>
      </div>
      <div className="flex items-center gap-3">
        <Character look={agent.look} color={agent.color} size={40} label="" />
        <div className="min-w-0 grow">
          <p className="truncate text-body font-medium">{agent.task}</p>
          <p className="text-meta text-fg-muted">
            {agent.agent ? `${agent.agent} · ` : ''}
            {agent.model.split('/').pop()} · <Status agent={agent} />
          </p>
        </div>
        {working && (
          <Button disabled={stop.isPending} onClick={() => stop.mutate({ sessionId, runId, memberId: agent.id })}>
            {t.stopOne}
          </Button>
        )}
      </div>
      {agent.state === 'failed' && agent.error && <p className="text-meta text-danger">{agent.error}</p>}
      {items.length === 0 ? (
        <p className="text-meta text-fg-faint">{t.nothingYet}</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg bg-canvas-sunken p-3">{renderRecord(items)}</div>
      )}
    </div>
  );
}
