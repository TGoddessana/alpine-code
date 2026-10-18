import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { FilePen, FileSearch, SquareTerminal } from 'lucide-react';

import { Character } from '@/shared/components/agent';
import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import type { RunAgent, RunSnapshot } from './run';
import { Workshop } from './Workshop';

/** Decision 6: the dock's 에이전트 tab. The room on top, one row per agent under it, a row opens its record. */
export function AgentsTab({
  run,
  selected,
  onSelect,
}: {
  run: RunSnapshot;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const t = useMessages(messages);
  const agent = run.agents.find((a) => a.id === selected);
  return (
    <div className="flex flex-col gap-4 p-4">
      <Workshop run={run} size={36} selected={selected} onSelect={onSelect} />
      {agent ? (
        <Record agent={agent} onBack={() => onSelect(null)} />
      ) : (
        <>
          <p className="text-meta text-fg-faint">{t.pickHint}</p>
          {run.phases.map((phase, i) => (
            <section key={phase.title} className="flex flex-col">
              <h3 className="mb-1 text-meta text-fg-muted">
                {phase.title} · {phase.model}
              </h3>
              {run.agents
                .filter((a) => a.phase === i)
                .map((a) => (
                  <Row key={a.id} agent={a} onSelect={onSelect} />
                ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function Row({ agent, onSelect }: { agent: RunAgent; onSelect: (id: string) => void }) {
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
      <span className="shrink-0 text-meta text-fg-faint">{agent.agent}</span>
      <span className="grow" />
      <Status agent={agent} />
    </button>
  );
}

function Status({ agent }: { agent: RunAgent }) {
  const t = useMessages(messages);
  switch (agent.state) {
    case 'working':
      return (
        <span className="shrink-0 text-meta text-interactive">
          {agent.activity} · {t.turn(agent.turn)}
        </span>
      );
    case 'asking':
      return <span className="shrink-0 text-meta text-attention">{t.asking}</span>;
    case 'queued':
      return <span className="shrink-0 text-meta text-fg-faint">{t.queued}</span>;
    case 'done':
      return <span className="shrink-0 text-meta text-fg-muted">{t.done}</span>;
    case 'stopped':
      return <span className="shrink-0 text-meta text-fg-muted">{t.stopped}</span>;
  }
}

/** A stand-in for the agent's conversation, drawn as the session draws tool calls, read-only. */
function Record({ agent, onBack }: { agent: RunAgent; onBack: () => void }) {
  const t = useMessages(messages);
  const lines = recordOf(agent);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" className="cursor-pointer text-meta text-fg-muted hover:text-fg" onClick={onBack}>
          {t.back}
        </button>
        <span className="grow" />
        <span className="text-meta text-fg-faint">{t.readOnly}</span>
      </div>
      <div className="flex items-center gap-3">
        <Character look={agent.look} color={agent.color} size={40} label="" />
        <div className="min-w-0 grow">
          <p className="text-body font-medium">{agent.task}</p>
          <p className="text-meta text-fg-muted">
            {agent.agent} · <Status agent={agent} />
          </p>
        </div>
        {(agent.state === 'working' || agent.state === 'asking' || agent.state === 'queued') && (
          <Button>{t.stopOne}</Button>
        )}
      </div>
      <ul className="flex flex-col gap-1.5 rounded-lg bg-canvas-sunken p-3">
        {lines.map(([kind, text], i) => (
          <li key={i} className="flex items-center gap-2 text-body">
            {kind === 'read' ? (
              <FileSearch size={14} className="shrink-0 text-fg-muted" />
            ) : kind === 'run' ? (
              <SquareTerminal size={14} className="shrink-0 text-fg-muted" />
            ) : (
              <FilePen size={14} className="shrink-0 text-fg-muted" />
            )}
            <span className="truncate font-mono text-meta">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Line = ['read' | 'run' | 'edit', string];

function recordOf(agent: RunAgent): Line[] {
  if (agent.state === 'queued') return [];
  const slug = agent.id.replace(/^\w+-/, 'topic-');
  const byPhase: Line[][] = [
    [
      ['run', 'ls src/backend'],
      ['read', 'README'],
      ['read', 'src/backend/access/transam/README'],
    ],
    [
      ['read', 'src/backend/replication/walsender.c'],
      ['read', 'doc/src/sgml/high-availability.sgml'],
      ['edit', `features/${slug}.md`],
    ],
    [
      ['read', `features/${slug}.md`],
      ['run', 'make check TESTS=recovery'],
      ['edit', `features/${slug}.md`],
    ],
    [
      ['read', 'features/'],
      ['edit', 'flows/'],
    ],
  ];
  const lines = byPhase[agent.phase] ?? [];
  return agent.state === 'done' ? lines : lines.slice(0, Math.max(1, Math.ceil(agent.turn / 6)));
}
