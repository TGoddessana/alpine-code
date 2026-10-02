import type { ApprovalItem } from '@alpine/protocol';
import { Button, LinkButton } from '@alpine/ui/primitives';

import { useMessages } from '@/shared/i18n';
import { useAnswerApproval } from '@/shared/server';

import { messages } from './messages';
import { CallTitle, Lines } from './ToolCalls';

/**
 * A call that waits for my answer, in the chat where the call will be: the call as the chat draws calls, the command
 * or diff it would run, and why it asks. Allow, always allow, or skip it: a skipped call is not run and the agent
 * carries on without it. To have it do something else instead, I write that in the input (see `Session`). The first
 * answer wins, so a click after another window answered does nothing.
 */
export function ApprovalCard({ sessionId, approval }: { sessionId: string; approval: ApprovalItem }) {
  const t = useMessages(messages);
  const answer = useAnswerApproval();
  const send = (decision: 'allow' | 'allow_always' | 'deny') =>
    answer.mutate({ sessionId, requestId: approval.id, decision });
  // The file names at the top of a diff repeat the call's own line.
  const preview =
    approval.previewKind === 'diff'
      ? approval.preview?.split('\n').filter((line) => !/^(---|\+\+\+) /.test(line))
      : approval.preview?.split('\n');

  return (
    <section
      aria-label={t.approvalLabel}
      className="flex flex-col gap-3 rounded-xl border border-line bg-canvas-raised p-3"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 grow">
          {/* Sessions saved before approvals carried their call have only the core's title. */}
          {approval.tool ? (
            <CallTitle name={approval.tool} args={approval.args} />
          ) : (
            <p className="text-body">{approval.title}</p>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-meta text-attention">
          <span aria-hidden="true">●</span>
          {t.approvalWaiting}
        </span>
      </div>
      {preview && (
        <div className="max-h-60 overflow-auto rounded-lg bg-canvas-sunken px-3 py-2">
          <Lines
            lines={preview[preview.length - 1] === '' ? preview.slice(0, -1) : preview}
            kind={approval.previewKind === 'diff' ? 'diff' : 'text'}
            failed={false}
            scroll={false}
          />
        </div>
      )}
      {approval.reason && <p className="text-body text-fg-muted">{approval.reason}</p>}
      {answer.isError && (
        <p role="alert" className="text-meta text-danger">
          {t.answerFailed}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={answer.isPending} onClick={() => send('allow')}>
          {t.allow}
        </Button>
        {approval.remember && (
          <Button
            disabled={answer.isPending}
            title={t.allowAlwaysFor(approval.remember)}
            onClick={() => send('allow_always')}
          >
            {t.allowAlways}
          </Button>
        )}
        <span className="grow" />
        <LinkButton disabled={answer.isPending} onClick={() => send('deny')}>
          {t.skip}
        </LinkButton>
      </div>
      <p className="text-meta text-fg-muted">{t.answerHint}</p>
    </section>
  );
}
