import type { FlowGetResult, FlowNode } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import { Pencil, Send } from 'lucide-react';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { ServerError, useEditFlow, useFlowNode, useReviewFlow } from '@/shared/server';

import { Conditions } from './Conditions';
import { Editable } from './Editable';
import { messages } from './messages';

/**
 * Under an open card: one box to ask the AI anything about the card in my own words (fix it, add the next step, split
 * it), and a plain recheck beside it.
 */
export function CardAsk({
  locked,
  onAsk,
  onRecheck,
}: {
  /** Another run is going, or the map cannot be written. */
  locked: boolean;
  /** Resolves true once the AI has the request. */
  onAsk: (request: string) => Promise<boolean>;
  onRecheck: () => void;
}) {
  const t = useMessages(messages);
  const [text, setText] = useState('');
  const send = async () => {
    if (await onAsk(text.trim())) setText('');
  };
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) void send();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-meta text-fg-muted">{t.askTitle}</span>
          <textarea
            value={text}
            rows={3}
            placeholder={t.askPlaceholder}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && text.trim()) {
                event.preventDefault();
                void send();
              }
            }}
            className="w-full resize-none rounded-lg border border-line bg-canvas-raised px-3 py-2 text-body"
          />
        </label>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={locked || !text.trim()}>
            <Send size={14} aria-hidden />
            {t.askSend}
          </Button>
          <Button disabled={locked} onClick={onRecheck}>
            {t.askRecheck}
          </Button>
        </div>
      </form>
    </div>
  );
}

export /** The card's title, which the user may rewrite; a later change by the agent is asked about. */
function Title({ cwd, node, mine, canEdit }: { cwd: string; node: FlowNode; mine?: string; canEdit: boolean }) {
  const t = useMessages(messages);
  const [editing, setEditing] = useState(false);
  const edit = useEditFlow();
  return (
    <div className="flex flex-col gap-1">
      {editing ? (
        <Editable
          value={node.title}
          label={t.editTitle}
          hint={t.editHint}
          maxLength={120}
          disabled={edit.isPending}
          onSave={(value, done) => edit.mutate({ cwd, nodeId: node.id, field: 'title', value }, { onSuccess: done })}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <h2 className="group flex items-start gap-1 text-title font-semibold">
          <span className="min-w-0">{node.title}</span>
          {canEdit && (
            <button
              type="button"
              aria-label={t.editTitle}
              title={t.editTitle}
              onClick={() => setEditing(true)}
              className="mt-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg"
            >
              <Pencil size={13} aria-hidden />
            </button>
          )}
        </h2>
      )}
      <EditError error={edit.error} />
      <FieldGuard cwd={cwd} node={node} field="title" mine={mine} canEdit={canEdit} />
    </div>
  );
}

/** "직접 해 보려면": what a person needs to try the card (accounts, keys, data, commands). */
export function HowToTry({
  cwd,
  node,
  mine,
  canEdit,
}: {
  cwd: string;
  node: FlowNode;
  mine?: string;
  canEdit: boolean;
}) {
  const t = useMessages(messages);
  const [editing, setEditing] = useState(false);
  const edit = useEditFlow();
  const text = node.howToTry ?? '';
  return (
    <section aria-label={t.howToTry} className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-1 text-lead font-semibold">
        {t.howToTry}
        {canEdit && !editing && text && (
          <button
            type="button"
            aria-label={t.editSentence}
            title={t.editSentence}
            onClick={() => setEditing(true)}
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg"
          >
            <Pencil size={13} aria-hidden />
          </button>
        )}
      </h3>
      {editing ? (
        <Editable
          value={text}
          label={t.howToTry}
          hint={t.editHint}
          placeholder={t.howToTryPlaceholder}
          maxLength={1000}
          multiline
          allowEmpty
          disabled={edit.isPending}
          onSave={(value, done) =>
            edit.mutate({ cwd, nodeId: node.id, field: 'how_to_try', value }, { onSuccess: done })
          }
          onCancel={() => setEditing(false)}
        />
      ) : text ? (
        <p className="text-body whitespace-pre-wrap">{text}</p>
      ) : (
        <p className="flex items-center gap-2 text-meta text-fg-muted">
          {t.howToTryEmpty}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="cursor-pointer text-meta text-interactive hover:underline"
            >
              {t.howToTryWrite}
            </button>
          )}
        </p>
      )}
      <EditError error={edit.error} />
      <FieldGuard cwd={cwd} node={node} field="how_to_try" mine={mine} canEdit={canEdit} />
    </section>
  );
}

function EditError({ error }: { error: Error | null }) {
  const t = useMessages(messages);
  if (!error) return null;
  return (
    <p role="alert" className="text-meta text-danger">
      {error instanceof ServerError && error.data?.reason === 'flow_busy' ? t.busyEdit : t.editFailed}
    </p>
  );
}

/** When the agent changed a sentence the user wrote: the user's text and the keep / put back answer. */
function FieldGuard({
  cwd,
  node,
  field,
  mine,
  canEdit,
}: {
  cwd: string;
  node: FlowNode;
  field: 'title' | 'how_to_try';
  mine?: string;
  canEdit: boolean;
}) {
  const t = useMessages(messages);
  const review = useReviewFlow();
  if (mine === undefined) return null;
  const answer = (action: 'accept' | 'restore') =>
    review.mutate({ cwd, target: 'field', action, nodeId: node.id, field });
  return (
    <div data-guard className="flex flex-col gap-2 rounded-lg border border-attention p-3">
      <p className="text-body font-medium text-attention">{t.aiChanged}</p>
      <p className="text-meta text-fg-muted">{t.yourVersion(mine || '—')}</p>
      <div className="flex gap-2">
        <Button disabled={review.isPending || !canEdit} onClick={() => answer('accept')}>
          {t.acceptChange}
        </Button>
        <Button disabled={review.isPending || !canEdit} onClick={() => answer('restore')}>
          {t.restoreMine}
        </Button>
      </div>
    </div>
  );
}

/**
 * Under an open promise (or, with `only` = REMOVED, under a card): everything about it from the map's records — what
 * its check saw and who stands behind it, the issue and its answers, a rule the AI guessed to confirm, the command to
 * re-run, and rewriting the sentence. Check pictures load once the card is open.
 */
export function PromiseMore({
  cwd,
  board,
  node,
  only,
  readOnly,
  editLocked,
  onRecheck,
  onNotARule,
}: {
  cwd: string;
  board: FlowGetResult;
  node: FlowNode;
  only: string;
  readOnly: boolean;
  editLocked: boolean;
  onRecheck: () => void;
  onNotARule: (conditionId: string) => void;
}) {
  const images = useFlowNode(cwd, node.id, board.revision).data;
  return (
    <Conditions
      cwd={cwd}
      node={node}
      state={board.states?.[node.id]}
      provenance={board.provenance}
      images={images}
      readOnly={readOnly}
      editLocked={editLocked}
      onRecheck={onRecheck}
      onNotARule={onNotARule}
      only={only}
    />
  );
}
