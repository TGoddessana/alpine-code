import clsx from 'clsx';
import type { ReactNode } from 'react';

/** A command's output or a diff in mono, a diff's added and removed lines tinted. */
export function Lines({
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
