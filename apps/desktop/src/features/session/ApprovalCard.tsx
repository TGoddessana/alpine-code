import type { ApprovalItem } from '@alpine/protocol';
import { Button, LinkButton } from '@alpine/ui/primitives';

import { Lines } from '@/shared/components/output';
import { useMessages } from '@/shared/i18n';
import { useAnswerApproval } from '@/shared/server';

import { messages } from './messages';
import { CallTitle } from './ToolCalls';

/**
 * A call that waits for my answer, in the chat where the call will be: the call as the chat draws calls, the command
 * or diff it would run, and why it asks. Allow, always allow, or skip it: a skipped call is not run and the agent
 * carries on without it. To have it do something else instead, I write that in the input (see `Session`). The first
 * answer wins, so a click after another window answered does nothing. When a TF's agents ask, the card shows each
 * agent's own call under what it works on (several agents asking under the same "always allow" rule share one card,
 * though their files or commands differ); the buttons below answer all of them, and a line's own skip answers only
 * that agent, which carries on without the call while the others wait for the card (TF decision 6).
 */
export function ApprovalCard({ sessionId, approval }: { sessionId: string; approval: ApprovalItem }) {
  const t = useMessages(messages);
  const answer = useAnswerApproval();
  const send = (decision: 'allow' | 'allow_always' | 'deny') =>
    answer.mutate({ sessionId, requestId: approval.id, decision });
  const skipOne = (agent: string) => answer.mutate({ sessionId, requestId: approval.id, decision: 'deny', agent });
  const asks = approval.askedBy;

  return (
    <section
      aria-label={t.approvalLabel}
      className="flex flex-col gap-3 rounded-xl border border-line bg-canvas-raised p-3"
    >
      {asks.length === 0 ? (
        <>
          <div className="flex items-start gap-3">
            <div className="min-w-0 grow">
              <Title call={approval} />
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-meta text-attention">
              <span aria-hidden="true">●</span>
              {t.approvalWaiting}
            </span>
          </div>
          <Preview call={approval} />
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1 text-meta text-attention">
            <span aria-hidden="true">●</span>
            {t.askedByAgents(asks.length)}
          </span>
          <ul className="flex flex-col divide-y divide-line-subtle">
            {asks.map((ask) => (
              <li
                key={ask.agent || ask.task}
                aria-label={ask.task}
                className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0"
              >
                <div className="flex items-baseline gap-3">
                  <p className="min-w-0 grow truncate text-meta text-fg-muted">{ask.task}</p>
                  {asks.length > 1 && ask.agent && (
                    <LinkButton
                      disabled={answer.isPending}
                      aria-label={t.skipOne(ask.task)}
                      onClick={() => skipOne(ask.agent)}
                    >
                      {t.skip}
                    </LinkButton>
                  )}
                </div>
                {/* Sessions saved before each agent's call was kept have only its task: the card's call stands in. */}
                <Title call={ask.title ? ask : approval} />
                <Preview call={ask.title ? ask : approval} />
              </li>
            ))}
          </ul>
        </>
      )}
      {approval.review === 'blocked_in_a_row' && <p className="text-body text-attention">{t.askedAfterBlocks}</p>}
      {approval.review === 'failed' && (
        <p className="text-body text-attention">
          {t.askedAfterFailure}
          {approval.reviewError && <span className="text-meta text-fg-muted"> · {approval.reviewError}</span>}
        </p>
      )}
      {approval.reason && <p className="text-body text-fg-muted">{approval.reason}</p>}
      {answer.isError && (
        <p role="alert" className="text-meta text-danger">
          {t.answerFailed}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={answer.isPending} onClick={() => send('allow')}>
          {asks.length > 1 ? t.allowAll : t.allow}
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
          {asks.length > 1 ? t.skipAll : t.skip}
        </LinkButton>
      </div>
      <p className="text-meta text-fg-muted">{t.answerHint}</p>
    </section>
  );
}

type Call = Pick<ApprovalItem, 'title' | 'tool' | 'args' | 'preview' | 'previewKind'>;

function Title({ call }: { call: Call }) {
  // Sessions saved before approvals carried their call have only the core's title.
  return call.tool ? <CallTitle name={call.tool} args={call.args} /> : <p className="text-body">{call.title}</p>;
}

function Preview({ call }: { call: Call }) {
  // The file names at the top of a diff repeat the call's own line.
  const preview =
    call.previewKind === 'diff'
      ? call.preview?.split('\n').filter((line) => !/^(---|\+\+\+) /.test(line))
      : call.preview?.split('\n');
  if (!preview) return null;
  return (
    <div className="max-h-60 overflow-auto rounded-lg bg-canvas-sunken px-3 py-2">
      <Lines
        lines={preview[preview.length - 1] === '' ? preview.slice(0, -1) : preview}
        kind={call.previewKind === 'diff' ? 'diff' : 'text'}
        failed={false}
        scroll={false}
      />
    </div>
  );
}
