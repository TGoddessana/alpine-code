import type { CloneInfo } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';

import { formatBytes, hostOf, ProgressBar, projectAddMessages } from '@/shared/components/project-add';
import { useMessages } from '@/shared/i18n';

/**
 * The centre of a new session whose project is still on its way: how far it got and a way to stop, or why it did not
 * arrive. When it arrives the screen becomes the usual new session; what was typed meanwhile stays in the input.
 */
export function Receiving({
  clone,
  onCancel,
  onRetry,
  onDismiss,
}: {
  clone: CloneInfo;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const t = useMessages(projectAddMessages);
  if (clone.state === 'failed') {
    const why =
      clone.reason === 'no_access'
        ? t.noAccess
        : clone.reason === 'unreachable'
          ? t.unreachable(hostOf(clone.address) ?? clone.address)
          : t.failed(clone.message ?? '');
    return (
      <div className="flex w-full max-w-100 flex-col items-center gap-3 text-center">
        <h1 className="text-title">{t.notReceived(clone.name)}</h1>
        <p className="text-body text-fg-muted">{why}</p>
        <div className="flex gap-2 pt-1">
          <Button onClick={onDismiss}>{t.dismiss}</Button>
          <Button variant="primary" onClick={onRetry}>
            {t.retry}
          </Button>
        </div>
      </div>
    );
  }
  const detail = [`${clone.percent}%`, clone.received ? t.received(formatBytes(clone.received)) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="flex w-full max-w-100 flex-col items-center gap-3 text-center">
      <h1 className="text-title">{t.receiving(clone.name)}</h1>
      <ProgressBar percent={clone.percent} className="w-65" />
      <p className="text-meta text-fg-muted">
        {detail} · {t.meanwhile}
      </p>
      <Button onClick={onCancel}>{t.cancel}</Button>
    </div>
  );
}
