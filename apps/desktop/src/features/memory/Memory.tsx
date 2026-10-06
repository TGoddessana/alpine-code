import type { MemoryEvidence, MemoryInfo } from '@alpine/protocol';
import { Button, LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { useState } from 'react';

import { Headline, SuggestionCard, useMemoryWords } from '@/shared/components/memory';
import { useFormat, useMessages } from '@/shared/i18n';
import { useForgetMemory, useMemory } from '@/shared/server';

import { messages } from './messages';

const SCOPES: MemoryInfo['scope'][] = ['team', 'project_me', 'me'];

/**
 * A project's memory: the suggestions waiting for me, then what is kept, by scope. Each memory is the line the
 * agent sees in its prompt; it opens to the reason, where it came from, when I said it again, and its file. Opened
 * from the project's menu in the rail, or from a kept suggestion in the chat.
 */
export function Memory({ project }: { project: string | null }) {
  const t = useMessages(messages);
  const words = useMemoryWords();
  const memory = useMemory(project);
  const list = memory.data;

  return (
    <div className="mx-auto flex w-full max-w-175 flex-col gap-6 px-6 pt-5 pb-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-title">{t.title}</h1>
        {project && <p className="text-body text-fg-muted">{t.lead(project.split('/').pop() || project)}</p>}
      </header>
      {!project ? (
        <p className="text-body text-fg-muted">{t.noProject}</p>
      ) : memory.isError ? (
        <p role="alert" className="text-body text-danger">
          {t.loadFailed}
        </p>
      ) : !list ? null : list.pending.length === 0 && list.memories.length === 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-body">{t.empty}</p>
          <p className="text-body text-fg-muted">{t.emptyLead}</p>
        </div>
      ) : (
        <>
          {list.pending.length > 0 && (
            <Part title={t.pending} count={list.pending.length}>
              {list.pending.map((suggestion) => (
                <SuggestionCard key={suggestion.id} cwd={project} suggestion={suggestion} />
              ))}
            </Part>
          )}
          {SCOPES.map((scope) => {
            const kept = list.memories.filter((m) => m.scope === scope);
            if (kept.length === 0) return null;
            return (
              <Part
                key={scope}
                title={words.scope(scope)}
                count={kept.length}
                lead={scope === 'team' ? t.teamLead : t.mineLead}
              >
                <ul className="flex flex-col divide-y divide-line-subtle rounded-xl border border-line">
                  {kept.map((m) => (
                    <Row key={m.id} cwd={project} memory={m} />
                  ))}
                </ul>
              </Part>
            );
          })}
        </>
      )}
    </div>
  );
}

function Part({
  title,
  count,
  lead,
  children,
}: {
  title: string;
  count: number;
  lead?: string;
  children: React.ReactNode;
}) {
  const format = useFormat();
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lead">{title}</h2>
        <span className="text-meta text-fg-muted">{format.number(count)}</span>
        {lead && <span className="text-meta text-fg-muted">· {lead}</span>}
      </div>
      {children}
    </section>
  );
}

/** One kept memory: its kind and the line the agent sees; opens to everything behind it. */
function Row({ cwd, memory }: { cwd: string; memory: MemoryInfo }) {
  const t = useMessages(messages);
  const format = useFormat();
  const words = useMemoryWords();
  const forget = useForgetMemory();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-start gap-3 px-3 py-2.5 text-left hover:bg-hover"
      >
        <span className="w-16 shrink-0 pt-px text-meta text-fg-muted">{words.kind(memory.kind)}</span>
        <span className="min-w-0 grow text-body">
          <Headline text={memory.headline} />
        </span>
        {memory.saidAgain.length > 0 && (
          <span className="shrink-0 pt-px text-meta text-attention">
            {t.saidAgain(format.number(memory.saidAgain.length))}
          </span>
        )}
        <span aria-hidden="true" className={clsx('shrink-0 text-fg-muted transition-transform', open && 'rotate-90')}>
          ›
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3 pl-22">
          {memory.body && <p className="text-body whitespace-pre-wrap text-fg-muted">{memory.body}</p>}
          <Said label={t.learnedFrom} evidence={memory.evidence} />
          <Said label={t.saidAgainWhen} evidence={memory.saidAgain} />
          {memory.path && (
            <p className="text-meta text-fg-muted">
              {t.file} <span className="font-mono break-all">{memory.path}</span>
            </p>
          )}
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-meta">{t.forgetConfirm}</span>
              <Button
                disabled={forget.isPending}
                className="text-danger"
                onClick={() => forget.mutate({ cwd, scope: memory.scope, memoryId: memory.id })}
              >
                {t.forget}
              </Button>
              <LinkButton onClick={() => setConfirming(false)}>{t.cancel}</LinkButton>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex min-h-7 w-fit cursor-pointer items-center rounded-sm text-meta text-danger hover:underline"
            >
              {t.forget}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** When something was said, and what: "3일 전 “린트!”". */
function Said({ label, evidence }: { label: string; evidence: MemoryEvidence[] }) {
  const format = useFormat();
  if (evidence.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 text-meta text-fg-muted">
      <span>{label}</span>
      {evidence.map((e) => (
        <p key={`${e.sessionId}-${e.at}`} className="line-clamp-2 text-fg">
          <span className="text-fg-muted">{format.since(new Date(e.at))}</span> “{e.quote}”
        </p>
      ))}
    </div>
  );
}
