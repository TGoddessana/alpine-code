import type { ApprovalItem } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { useAnswerApproval } from '@/shared/server';

import { messages } from './messages';

/**
 * The approval that waits for an answer, above the input: what it wants to do, the command or diff in mono, and
 * why. Allow, always allow, or deny, and a deny may say why so the agent can change course. The first answer
 * wins, so a click after another window answered does nothing.
 */
export function ApprovalDock({ sessionId, approval }: { sessionId: string; approval: ApprovalItem }) {
  const t = useMessages(messages);
  const answer = useAnswerApproval();
  const [feedback, setFeedback] = useState('');

  const send = (decision: 'allow' | 'allow_always' | 'deny') =>
    answer.mutate({
      sessionId,
      requestId: approval.id,
      decision,
      ...(decision === 'deny' && feedback.trim() ? { feedback: feedback.trim() } : {}),
    });

  return (
    <section
      aria-label={t.approvalLabel}
      className="flex flex-col gap-3 rounded-xl border border-line bg-canvas-raised p-4"
    >
      <div className="flex items-center gap-3">
        <h2 className="min-w-0 grow truncate text-lead">{approval.title}</h2>
        <span className="inline-flex shrink-0 items-center gap-1 text-meta text-attention">
          <span aria-hidden="true">●</span>
          {t.approvalWaiting}
        </span>
      </div>
      {approval.preview && (
        <pre
          className={
            approval.previewKind === 'diff'
              ? 'max-h-60 overflow-auto rounded-lg bg-canvas-sunken p-3 font-mono text-meta whitespace-pre'
              : 'max-h-60 overflow-auto rounded-lg bg-canvas-sunken p-3 font-mono text-meta whitespace-pre-wrap'
          }
        >
          {approval.preview}
        </pre>
      )}
      {approval.reason && <p className="text-body text-fg-muted">{approval.reason}</p>}
      <div className="flex flex-col gap-1">
        <label htmlFor="approval-feedback" className="text-meta text-fg-muted">
          {t.feedback}
        </label>
        <input
          id="approval-feedback"
          value={feedback}
          placeholder={t.feedbackPlaceholder}
          onChange={(event) => setFeedback(event.target.value)}
          className="min-h-8 rounded-lg border border-line bg-canvas-raised px-3 text-body text-fg placeholder:text-fg-muted"
        />
      </div>
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
        <Button disabled={answer.isPending} onClick={() => send('deny')}>
          {t.deny}
        </Button>
      </div>
    </section>
  );
}
