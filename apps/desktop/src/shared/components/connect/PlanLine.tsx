import { LinkButton } from '@alpine/ui/primitives';

import { useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import { CHATGPT_USAGE_URL, useConnections } from '@/shared/server';

import { messages } from './messages';

/**
 * 'Using ChatGPT plan · Manage usage ↗' when `model` (`<connection>/<model>`) runs on a ChatGPT connection, as
 * OpenAI asks near the input; nothing otherwise.
 */
export function PlanLine({ model }: { model: string | null | undefined }) {
  const t = useMessages(messages);
  const connections = useConnections().data?.connections ?? [];
  const name = model?.slice(0, model.indexOf('/'));
  if (!connections.find((c) => c.name === name)?.account) return null;
  return (
    <span className="inline-flex items-center gap-2 text-meta whitespace-nowrap text-fg-muted">
      <span>{t.chatgptInUse}</span>
      <span aria-hidden="true" className="text-fg-faint">
        ·
      </span>
      <LinkButton className="min-h-6 px-0.5" onClick={() => void openInBrowser(CHATGPT_USAGE_URL)}>
        {t.manageUsage}
      </LinkButton>
    </span>
  );
}
