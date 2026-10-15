import type { ToolCallItem } from '@alpine/protocol';
import clsx from 'clsx';
import { FileText, Terminal } from 'lucide-react';
import { useState } from 'react';

import { Lines } from '@/shared/components/output';
import { useFormat, useMessages } from '@/shared/i18n';

import { messages } from './messages';
import type { ChangedFile, RanCommand, WorkResult as Result } from './results';

/**
 * What the work changed and ran, as the dock's work result tab: the changed files (a click shows what changed), then
 * the commands. A part with nothing in it is left out, so an empty tab says one line instead of a list of "none". With
 * no result (no work connected to this page) it says so in one line. The dock supplies the frame, header and width.
 */
export function WorkResult({ result }: { result: Result | null }) {
  const t = useMessages(messages);
  const format = useFormat();
  if (!result) return <p className="text-body text-fg-muted">{t.notConnected}</p>;
  const { files, commands } = result;

  return (
    <div className="flex flex-col gap-6">
      {files.length === 0 && commands.length === 0 && <p className="text-body text-fg-muted">{t.nothingYet}</p>}
      {files.length > 0 && (
        <section aria-label={t.files} className="flex flex-col gap-1">
          <h3 className="flex min-h-7 items-center gap-1.5 text-lead">
            {t.files}
            <span className="text-meta text-fg-muted">{format.number(files.length)}</span>
          </h3>
          {files.map((file) => (
            <FileRow key={file.path} file={file} />
          ))}
        </section>
      )}
      {commands.length > 0 && (
        <section aria-label={t.commands} className="flex flex-col gap-1">
          <h3 className="flex min-h-7 items-center gap-1.5 text-lead">
            {t.commands}
            <span className="text-meta text-fg-muted">{format.number(commands.length)}</span>
          </h3>
          {commands.map((command) => (
            <CommandRow key={command.id} command={command} />
          ))}
        </section>
      )}
    </div>
  );
}

const fileIcon = <FileText size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-fg-faint" />;

/** A changed file: its name, where it lives, and how many lines it added and removed. A click shows the diff. */
function FileRow({ file }: { file: ChangedFile }) {
  const t = useMessages(messages);
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  const folder = slash > 0 ? file.path.slice(0, slash) : '';
  const body = (
    <>
      {fileIcon}
      <span className="flex min-w-0 grow flex-col">
        <span className="truncate text-body">{name}</span>
        {folder && <span className="truncate text-meta text-fg-muted">{folder}</span>}
      </span>
      {file.diff && (
        <span className="shrink-0 text-meta whitespace-nowrap text-fg-muted tabular-nums">
          +{format.number(file.added)} −{format.number(file.removed)}
        </span>
      )}
    </>
  );
  const row = 'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left';

  if (!file.diff) {
    return (
      <div className={row} title={file.path}>
        {body}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        title={file.path}
        onClick={() => setOpen(!open)}
        className={clsx(row, 'cursor-pointer hover:bg-hover', open && 'bg-hover')}
      >
        {body}
      </button>
      {open && (
        <div
          aria-label={t.showChanges(name)}
          role="region"
          className="mt-1 mb-2 overflow-hidden rounded-lg border border-line-subtle bg-canvas-raised"
        >
          <Lines lines={file.diff} kind="diff" failed={false} scroll />
        </div>
      )}
    </>
  );
}

const stateOf = {
  running: 'running',
  done: 'done',
  error: 'failed',
  input_error: 'failed',
  aborted: 'failed',
  interrupted: 'interrupted',
  denied: 'interrupted',
  cancelled: 'interrupted',
} as const satisfies Record<ToolCallItem['status'], keyof (typeof messages)['en']>;

/** A command as it was typed, in mono since it is code, with how it went beside it. */
function CommandRow({ command }: { command: RanCommand }) {
  const t = useMessages(messages);
  const state = stateOf[command.status];
  return (
    <div className="flex min-h-9 items-start gap-2.5 px-2 py-2">
      <Terminal size={16} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-faint" />
      <code className="min-w-0 grow font-mono text-meta break-all text-fg">{command.command}</code>
      <span
        className={clsx(
          'shrink-0 text-meta whitespace-nowrap',
          state === 'failed' ? 'text-danger' : 'text-fg-muted',
          state === 'running' && 'animate-pulse motion-reduce:animate-none',
        )}
      >
        {t[state]}
      </span>
    </div>
  );
}
