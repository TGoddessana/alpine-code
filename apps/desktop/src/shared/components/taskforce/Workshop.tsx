import clsx from 'clsx';
import { Check, FileText, X } from 'lucide-react';

import { Character } from '@/shared/components/agent';
import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import type { Room, RoomAgent } from './room';

const HEADER = 30;

/**
 * A TF as a room: one area per step, a hare per agent. Working hares hop, a hare waiting for an approval raises a
 * question, a hare that finished walks its result over to whoever takes it next. Nothing here needs explaining:
 * agents working together on something, step by step (decision 6).
 */
export function Workshop({
  room,
  size = 40,
  labels = true,
  selected,
  onSelect,
}: {
  room: Room;
  size?: number;
  labels?: boolean;
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  const t = useMessages(messages);
  const rowHeight = size + (labels ? 34 : 14);
  const layout = room.steps.map((_, phase) => {
    const count = room.agents.filter((a) => a.phase === phase).length;
    const columns = count <= 1 ? 1 : count <= 8 ? 2 : labels ? 3 : 4;
    return { count, columns, rows: Math.ceil(count / columns) };
  });
  const rows = Math.max(1, ...layout.map((l) => l.rows));
  const height = HEADER + rows * rowHeight + 8;
  const width = 100 / Math.max(1, room.steps.length);
  const spots = new Map(room.agents.map((agent) => [agent.id, spot(room, agent, layout, rows, rowHeight)]));

  return (
    <div className="relative w-full select-none" style={{ height }}>
      {room.steps.map((step, i) => {
        const agents = room.agents.filter((a) => a.phase === i);
        const done = agents.filter((a) => a.state === 'done').length;
        const active = agents.some((a) => a.state === 'working' || a.state === 'asking');
        return (
          <div
            key={`${i}-${step.title}`}
            className={clsx(
              'absolute top-0 bottom-0 rounded-lg border transition-colors',
              active ? 'border-line bg-canvas-sunken' : 'border-line-subtle bg-canvas-sunken/50',
            )}
            style={{ left: `calc(${i * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
          >
            <div className="flex items-center gap-1 px-2 pt-1.5 text-meta">
              <span className={clsx('truncate', active ? 'text-fg' : 'text-fg-muted')}>{step.title}</span>
              {labels && step.model && <span className="shrink-0 text-fg-faint">· {step.model}</span>}
              <span className="grow" />
              <span className="shrink-0 text-fg-faint tabular-nums">{t.progress(done, agents.length)}</span>
            </div>
          </div>
        );
      })}
      {room.agents.map((agent) => {
        const { x, y } = agent.handing ? handOver(room, agent, spots, width) : spots.get(agent.id)!;
        const columns = layout[agent.phase]?.columns ?? 1;
        return (
          <Hare
            key={agent.id}
            agent={agent}
            size={size}
            label={labels}
            x={x}
            y={y}
            span={width / columns}
            selected={selected === agent.id}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

function Hare({
  agent,
  size,
  label,
  x,
  y,
  span,
  selected,
  onSelect,
}: {
  agent: RoomAgent;
  size: number;
  label: boolean;
  x: number;
  y: number;
  /** The width of one column of a step's area, in percent of the room; the name is cut to it. */
  span: number;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const status = useStatus(agent);
  const placeholder = agent.task === '';
  return (
    <button
      type="button"
      title={placeholder ? undefined : `${agent.task} · ${status}`}
      disabled={placeholder || !onSelect}
      onClick={() => onSelect?.(agent.id)}
      className={clsx(
        'motion-walk absolute flex flex-col items-center',
        !placeholder && onSelect && 'cursor-pointer',
        (agent.state === 'queued' || agent.state === 'stopped' || agent.state === 'failed') && 'opacity-35',
        agent.handing && 'z-10',
      )}
      style={{ left: `${x - span / 2}%`, top: y, width: `${span}%` }}
    >
      <span className="relative">
        <span
          className={clsx(
            'block rounded-lg',
            agent.state === 'working' && 'motion-hop-slow',
            agent.handing && 'motion-hop',
            selected && 'outline-2 outline-offset-2 outline-interactive',
          )}
        >
          <Character look={agent.look} color={agent.color} size={size} label="" />
        </span>
        {agent.state === 'working' && (
          <span className="absolute -top-2 -right-3 flex gap-0.5 rounded-full border border-line bg-canvas-raised px-1 py-0.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="motion-dot size-1 rounded-full bg-fg-muted" />
            ))}
          </span>
        )}
        {agent.state === 'asking' && (
          <span className="motion-raise absolute -top-3 -right-3 flex size-5 items-center justify-center rounded-full bg-attention text-meta font-medium text-on-fill">
            ?
          </span>
        )}
        {agent.state === 'done' && !agent.handing && (
          <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border border-canvas-raised bg-interactive text-on-fill">
            <Check size={10} strokeWidth={3} />
          </span>
        )}
        {agent.state === 'failed' && (
          <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border border-canvas-raised bg-danger text-on-fill">
            <X size={10} strokeWidth={3} />
          </span>
        )}
        {agent.handing && (
          <span className="absolute -right-3 bottom-0 flex size-5 items-center justify-center rounded-md border border-line bg-canvas-raised text-fg-muted">
            <FileText size={12} />
          </span>
        )}
      </span>
      {label && <span className="mt-1 max-w-full truncate px-0.5 text-meta text-fg-muted">{agent.task}</span>}
    </button>
  );
}

/** What a member is doing, in words. */
export function useStatus(agent: Pick<RoomAgent, 'state' | 'activity'>): string {
  const t = useMessages(messages);
  switch (agent.state) {
    case 'working':
      return t[`activity_${agent.activity ?? 'thinking'}`];
    case 'asking':
      return t.asking;
    case 'queued':
      return t.queued;
    case 'done':
      return t.done;
    case 'failed':
      return t.failed;
    case 'stopped':
      return t.stopped;
  }
}

function spot(
  room: Room,
  agent: RoomAgent,
  layout: { count: number; columns: number; rows: number }[],
  rows: number,
  rowHeight: number,
) {
  const mates = room.agents.filter((a) => a.phase === agent.phase);
  const index = mates.indexOf(agent);
  const { columns, rows: own } = layout[agent.phase] ?? { columns: 1, rows: 1 };
  const width = 100 / Math.max(1, room.steps.length);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const offset = ((rows - own) * rowHeight) / 2;
  return { x: agent.phase * width + ((column + 0.5) / columns) * width, y: HEADER + offset + row * rowHeight };
}

/** Where a hare stands while handing its result over: just left of the agent that takes it. */
function handOver(room: Room, agent: RoomAgent, spots: Map<string, { x: number; y: number }>, width: number) {
  const taker = room.agents.find((a) => a.source === agent.id) ?? agent;
  const target = spots.get(taker.id)!;
  return { x: target.x - width / 5, y: target.y };
}
