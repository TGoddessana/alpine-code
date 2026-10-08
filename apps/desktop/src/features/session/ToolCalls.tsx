import type { ReviewBlockedItem, ToolCallItem } from '@alpine/protocol';
import { LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { memo, useState } from 'react';

import { Lines } from '@/shared/components/output';
import { useFormat, useMessages } from '@/shared/i18n';
import { toolKind, toolTarget, type ToolKind } from '@/shared/tool-calls';

import { PREVIEW_LINES, toolSummary, type ToolRow, type ToolSummary } from './blocks';
import { messages } from './messages';

type Messages = (typeof messages)['en'];

/** Each state in words. There is no mark beside a call: the line under it says the state, and a failure is red. */
const wordOf = {
  running: 'toolRunning',
  done: 'toolDone',
  error: 'toolFailed',
  input_error: 'toolFailed',
  aborted: 'toolFailed',
  interrupted: 'toolInterrupted',
  denied: 'toolDenied',
  cancelled: 'toolCancelled',
} as const satisfies Record<ToolCallItem['status'], keyof Messages>;

const KINDS: ToolKind[] = ['run', 'read', 'search', 'edit', 'memory', 'other'];

/**
 * The tool calls of one stretch of work as one line, as Claude Code's app does: what they did, counted ("명령 3개
 * 실행 · 파일 2개 읽음"), and how many failed or did not run. Opening it lists each call as Claude Code draws it:
 * `Kind(target)`, then an indented line with what came of it. A call still running shows under the line even
 * while it is closed, so the work never looks frozen.
 */
export function ToolCalls({ rows }: { rows: ToolRow[] }) {
  const t = useMessages(messages);
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const count = (test: (row: ToolRow) => boolean) => rows.filter(test).length;

  const done = KINDS.map((kind) => [kind, count((row) => toolKind(row.call.name) === kind)] as const)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => t[`did_${kind}`](format.number(n)));
  // English starts with whichever kind comes first; Korean has no case, so this changes nothing there.
  const summary = done.join(' · ').replace(/^./, (c) => c.toUpperCase());
  const failed = count((row) => wordOf[row.call.status] === 'toolFailed');
  const skipped = count((row) => ['denied', 'cancelled', 'interrupted'].includes(row.call.status));
  const running = rows.filter((row) => row.call.status === 'running');

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-6 w-fit cursor-pointer items-center gap-1 rounded-md text-meta text-fg-muted hover:text-fg"
      >
        {summary}
        {failed > 0 && <span className="text-danger"> · {t.didFail(format.number(failed))}</span>}
        {skipped > 0 && <span> · {t.didSkip(format.number(skipped))}</span>}
        <span aria-hidden="true" className={clsx('inline-block transition-transform', open && 'rotate-90')}>
          ›
        </span>
      </button>
      {(open || running.length > 0) && (
        <ul className="flex flex-col gap-3 border-l border-line-subtle pl-3">
          {(open ? rows : running).map((row) => (
            <Call key={row.call.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Drawn again only when its call or its approval changed, not on every frame of a streaming reply. */
const Call = memo(
  function Call({ row }: { row: ToolRow }) {
    const { call } = row;

    return (
      <li className="flex flex-col gap-0.5">
        <CallTitle name={call.name} args={call.args} />
        <div className="flex min-w-0 flex-col items-start pl-4 text-meta text-fg-muted">
          <Summary row={row} summary={toolSummary(row)} />
        </div>
      </li>
    );
  },
  (before, after) => before.row.call === after.row.call && before.row.approval === after.row.approval,
);

/**
 * A call auto mode's reviewer blocked, as one line in the chat: who stopped it, the call as calls are drawn, and the
 * reviewer's reason. The agent was told the reason and went on; to let it through, I say so in the input.
 */
export function BlockedLine({ item }: { item: ReviewBlockedItem }) {
  const t = useMessages(messages);
  return (
    <div className="flex flex-col gap-0.5" role="note" aria-label={t.blockedLabel}>
      <CallTitle name={item.tool} args={item.args} />
      <p className="pl-4 text-meta whitespace-pre-wrap text-fg-muted">
        <span className="text-attention">{t.blockedBy}</span>
        {item.reason && <span className="text-fg"> · {item.reason}</span>}
      </p>
    </div>
  );
}

/** A call as `Kind(target)`: the kind in words, then what it works on in mono. */
export function CallTitle({ name, args }: { name: string; args: Record<string, unknown> }) {
  const t = useMessages(messages);
  const target = toolTarget({ args });
  return (
    <p className="line-clamp-3 min-w-0 text-body break-all" title={target}>
      <span className="text-fg">{t[toolKind(name)]}</span>
      {target && <span className="font-mono text-meta text-fg-muted">({target})</span>}
    </p>
  );
}

function Summary({ row, summary }: { row: ToolRow; summary: ToolSummary }) {
  const t = useMessages(messages);
  const format = useFormat();
  const { call, approval } = row;
  switch (summary.type) {
    case 'state': {
      const word = t[wordOf[call.status]];
      if (call.status === 'running') return <span>{word}…</span>;
      // Denied without asking me: a memory check refused it, and what it said is the reason.
      const feedback = call.status === 'denied' ? (approval ? approval.feedback : call.result) : null;
      return (
        <span className={clsx('whitespace-pre-wrap', word === t.toolFailed && 'text-danger')}>
          {word}
          {feedback && <span className="text-fg"> · “{feedback}”</span>}
        </span>
      );
    }
    case 'done':
      return <span>{t.toolDone}</span>;
    case 'count': {
      const count = format.number(summary.count);
      const label =
        summary.count === 0 && summary.unit !== 'lines' && summary.unit !== 'entries'
          ? t.foundNothing
          : { lines: t.readLines, entries: t.readEntries, files: t.foundFiles, matches: t.foundMatches }[summary.unit](
              count,
            );
      return summary.count === 0 ? <span>{label}</span> : <Opens label={label} text={summary.text} />;
    }
    case 'output':
      return (
        <>
          {summary.kind === 'diff' && (
            <span>{t.changed(format.number(summary.added), format.number(summary.removed))}</span>
          )}
          <Output text={summary.text} kind={summary.kind} failed={summary.failed} />
        </>
      );
  }
}

/** A count ("Read 120 lines") that shows what it counts when clicked. */
function Opens({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-sm hover:text-fg"
      >
        {label}
        <span aria-hidden="true" className={clsx('inline-block transition-transform', open && 'rotate-90')}>
          ›
        </span>
      </button>
      {open && <Lines lines={text.split('\n')} kind="text" failed={false} scroll />}
    </>
  );
}

/** Output or a diff, its first lines only until I ask for the rest. */
function Output({ text, kind, failed }: { text: string; kind: 'diff' | 'text'; failed: boolean }) {
  const t = useMessages(messages);
  const format = useFormat();
  const [all, setAll] = useState(false);
  const lines = text.split('\n');
  const preview = PREVIEW_LINES[kind];
  // A cut that would hide only a line or two is not worth the extra click.
  const hidden = lines.length > preview + 2 ? lines.length - preview : 0;

  return (
    <>
      <Lines lines={all || !hidden ? lines : lines.slice(0, preview)} kind={kind} failed={failed} scroll={all} />
      {hidden > 0 && (
        <LinkButton className="-ml-1 min-h-6" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? t.showLess : t.showMore(format.number(hidden))}
        </LinkButton>
      )}
    </>
  );
}
