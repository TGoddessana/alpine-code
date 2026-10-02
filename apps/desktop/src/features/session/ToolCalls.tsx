import type { ToolCallItem } from '@alpine/protocol';
import { LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { memo, useState, type ReactNode } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';

import {
  PREVIEW_LINES,
  toolKind,
  toolSummary,
  toolTarget,
  type ToolKind,
  type ToolRow,
  type ToolSummary,
} from './blocks';
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

const KINDS: ToolKind[] = ['run', 'read', 'search', 'edit', 'other'];

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
    const t = useMessages(messages);
    const { call } = row;
    const target = toolTarget(call);

    return (
      <li className="flex flex-col gap-0.5">
        <p className="line-clamp-3 min-w-0 text-body break-all" title={target}>
          <span className="text-fg">{t[toolKind(call.name)]}</span>
          {target && <span className="font-mono text-meta text-fg-muted">({target})</span>}
        </p>
        <div className="flex min-w-0 flex-col items-start pl-4 text-meta text-fg-muted">
          <Summary row={row} summary={toolSummary(row)} />
        </div>
      </li>
    );
  },
  (before, after) => before.row.call === after.row.call && before.row.approval === after.row.approval,
);

function Summary({ row, summary }: { row: ToolRow; summary: ToolSummary }) {
  const t = useMessages(messages);
  const format = useFormat();
  const { call, approval } = row;
  switch (summary.type) {
    case 'state': {
      const word = t[wordOf[call.status]];
      if (call.status === 'running') return <span>{word}…</span>;
      const feedback = call.status === 'denied' ? approval?.feedback : null;
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

function Lines({
  lines,
  kind,
  failed,
  scroll,
}: {
  lines: string[];
  kind: 'diff' | 'text';
  failed: boolean;
  scroll: boolean;
}) {
  return (
    <pre
      className={clsx(
        'w-full overflow-x-auto font-mono text-meta whitespace-pre',
        failed ? 'text-danger' : 'text-fg',
        scroll && 'max-h-96 overflow-y-auto',
      )}
    >
      {kind === 'diff' ? lines.map((line, i) => <DiffLine key={i} line={line} />) : lines.join('\n')}
    </pre>
  );
}

function DiffLine({ line }: { line: string }): ReactNode {
  const tone = line.startsWith('+')
    ? 'bg-diff-added'
    : line.startsWith('-')
      ? 'bg-diff-removed'
      : line.startsWith('@@')
        ? 'text-fg-muted'
        : '';
  return <div className={clsx('min-w-fit px-1', tone)}>{line || ' '}</div>;
}
