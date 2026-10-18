import clsx from 'clsx';
import { Check, FileText } from 'lucide-react';

import { Character } from '@/shared/components/agent';
import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import type { RunAgent, RunSnapshot } from './run';

const HEADER = 30;

/**
 * The run as a room: one area per step of the script, a hare per agent. Working hares hop, a hare waiting for an
 * approval raises a question, a hare that finished walks its result over to whoever takes it next. Nothing here
 * needs explaining: agents working together on something, step by step.
 */
export function Workshop({
  run,
  size = 40,
  labels = true,
  selected,
  onSelect,
}: {
  run: RunSnapshot;
  size?: number;
  labels?: boolean;
  selected?: string | null;
  onSelect?: (id: string) => void;
}) {
  const t = useMessages(messages);
  const rowHeight = size + (labels ? 34 : 14);
  const rows = Math.max(...run.phases.map((_, phase) => rowsOf(run.agents.filter((a) => a.phase === phase).length)));
  const height = HEADER + rows * rowHeight + 8;
  const width = 100 / run.phases.length;
  const spots = new Map(run.agents.map((agent) => [agent.id, spot(run, agent, rowHeight)]));

  return (
    <div className="relative w-full select-none" style={{ height }}>
      {run.phases.map((phase, i) => {
        const agents = run.agents.filter((a) => a.phase === i);
        const done = agents.filter((a) => a.state === 'done').length;
        const active = agents.some((a) => a.state === 'working' || a.state === 'asking');
        return (
          <div
            key={phase.title}
            className={clsx(
              'absolute top-0 bottom-0 rounded-lg border transition-colors',
              active ? 'border-line bg-canvas-sunken' : 'border-line-subtle bg-canvas-sunken/50',
            )}
            style={{ left: `calc(${i * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
          >
            <div className="flex items-center gap-1 px-2 pt-1.5 text-meta">
              <span className={active ? 'text-fg' : 'text-fg-muted'}>{phase.title}</span>
              {labels && <span className="text-fg-faint">· {phase.model}</span>}
              <span className="grow" />
              <span className="text-fg-faint tabular-nums">{t.progress(done, agents.length)}</span>
            </div>
          </div>
        );
      })}
      {run.agents.map((agent) => {
        const { x, y } = agent.handing ? handOver(run, agent, spots) : spots.get(agent.id)!;
        return (
          <Hare
            key={agent.id}
            agent={agent}
            size={size}
            label={labels}
            x={x}
            y={y}
            span={width / 2}
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
  agent: RunAgent;
  size: number;
  label: boolean;
  x: number;
  y: number;
  /** The width of one column of a step's area, in percent of the room; the name is cut to it. */
  span: number;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const t = useMessages(messages);
  const status =
    agent.state === 'working'
      ? agent.activity
      : agent.state === 'asking'
        ? t.asking
        : agent.state === 'queued'
          ? t.queued
          : agent.state === 'done'
            ? t.done
            : t.stopped;
  return (
    <button
      type="button"
      title={`${agent.task} · ${status}`}
      onClick={() => onSelect?.(agent.id)}
      className={clsx(
        'motion-walk absolute flex cursor-pointer flex-col items-center',
        agent.state === 'queued' && 'opacity-35',
        agent.handing && 'z-10',
      )}
      style={{ left: `${x - span / 2}%`, top: y, width: `${span}%` }}
    >
      <span className="relative">
        <span
          className={clsx(
            'block rounded-lg',
            agent.state === 'working' && (agent.handing ? 'motion-hop' : 'motion-hop-slow'),
            agent.handing && 'motion-hop',
            selected && 'outline-2 outline-offset-2 outline-interactive',
          )}
        >
          <Character look={agent.look} color={agent.color} size={size} label="" />
        </span>
        {agent.state === 'working' && !agent.handing && (
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
        {agent.handing && (
          <span className="absolute -right-3 bottom-0 flex size-5 items-center justify-center rounded-md border border-line bg-canvas-raised text-fg-muted">
            <FileText size={12} />
          </span>
        )}
      </span>
      {label && <span className="mt-1 max-w-full truncate text-meta text-fg-muted">{agent.task}</span>}
    </button>
  );
}

function rowsOf(count: number) {
  return Math.ceil(count / (count > 1 ? 2 : 1));
}

function spot(run: RunSnapshot, agent: RunAgent, rowHeight: number) {
  const mates = run.agents.filter((a) => a.phase === agent.phase);
  const index = mates.indexOf(agent);
  const columns = mates.length > 1 ? 2 : 1;
  const width = 100 / run.phases.length;
  const column = index % columns;
  const row = Math.floor(index / columns);
  const rows = rowsOf(mates.length);
  const all = Math.max(...run.phases.map((_, phase) => rowsOf(run.agents.filter((a) => a.phase === phase).length)));
  const offset = ((all - rows) * rowHeight) / 2;
  return { x: agent.phase * width + ((column + 0.5) / columns) * width, y: HEADER + offset + row * rowHeight };
}

/** Where a hare stands while handing its result over: just left of the agent that takes it. */
function handOver(run: RunSnapshot, agent: RunAgent, spots: Map<string, { x: number; y: number }>) {
  const taker =
    run.agents.find((a) => a.from === agent.id) ?? run.agents.find((a) => a.phase === agent.phase + 1) ?? agent;
  const target = spots.get(taker.id)!;
  return { x: target.x - 100 / run.phases.length / 5, y: target.y };
}
