import { Button, LinkButton } from '@alpine/ui/primitives';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

/**
 * Decision 14: when the AI is done it offers to publish, with what it checked. The card sits in the conversation;
 * 올리기 opens the same sheet as the top bar's button, where the security checks run.
 */
export function PublishOffer({
  evidence,
  onPublish,
  onLater,
  onEvidence,
}: {
  evidence: number;
  onPublish: () => void;
  onLater: () => void;
  onEvidence?: () => void;
}) {
  const t = useMessages(messages);
  return (
    <div className="motion-step flex flex-col gap-3 rounded-xl border border-line bg-canvas-raised p-4">
      <div className="flex flex-col gap-1">
        <p className="text-reading text-fg">{t.offer}</p>
        <LinkButton className="-ml-1 self-start" onClick={onEvidence}>
          {t.offerEvidence(evidence)}
        </LinkButton>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line-subtle pt-3">
        <p className="text-body text-fg">{t.offerAsk}</p>
        <div className="flex gap-2">
          <Button onClick={onLater}>{t.later}</Button>
          <Button variant="primary" onClick={onPublish}>
            {t.publish}
          </Button>
        </div>
      </div>
    </div>
  );
}
