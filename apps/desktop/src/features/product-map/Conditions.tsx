import type { FlowNode } from '@alpine/protocol';
import { useMessages } from '@/shared/i18n';
import { messages } from './messages';
import { conditionResults } from './model';

export function Conditions({ node, staleIds }: { node: FlowNode; staleIds?: string[] }) {
  const t = useMessages(messages);
  const results = conditionResults(node, staleIds);
  const labels = {
    passed: t.conditionPassed,
    failed: t.conditionFailed,
    blocked: t.blocked,
    recheck: t.recheck,
    unconfirmed: t.unconfirmed,
  };
  return (
    <section className="mt-4" aria-label={t.promises}>
      <h3 className="text-lead font-semibold">{t.promises}</h3>
      <p className="my-2 text-meta text-fg-muted">
        {results.length
          ? t.coverage(results.filter((item) => item.status === 'passed').length, results.length)
          : t.noPromises}
      </p>
      {results.map(({ condition, check, status }) => (
        <details key={condition.id} className="mb-2 rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-body">
            <span
              className={
                status === 'failed' ? 'text-danger' : status === 'recheck' ? 'text-attention' : 'text-fg-muted'
              }
            >
              {labels[status]}
            </span>
            <p className="mt-1">{condition.expectation}</p>
          </summary>
          {check ? (
            <>
              <p className="mt-2 text-meta text-fg-muted">{t.reportNote}</p>
              {status === 'recheck' && <p className="mt-2 text-meta text-attention">{t.stale}</p>}
              <p className="mt-2 text-body">{check.summary}</p>
              {check.expectation !== condition.expectation && (
                <p className="mt-2 text-meta text-fg-muted">{check.expectation}</p>
              )}
              <pre className="mt-2 overflow-x-auto font-mono text-meta whitespace-pre-wrap">
                {check.command}
                {'\n\n'}
                {check.output}
              </pre>
            </>
          ) : (
            <p className="mt-2 text-meta text-fg-muted">{t.unchecked}</p>
          )}
        </details>
      ))}
    </section>
  );
}
