import type { AgentInfo } from '@alpine/protocol';
import { useEffect } from 'react';

import { Character } from '@/shared/components/agent';
import { useMessages } from '@/shared/i18n';

import { agentsMessages } from './messages';

const SHOWN_MS = 4000;

/**
 * Says what was added or removed, with the agent's face and a way back. It goes by itself after four seconds; a new
 * `id` starts the count again.
 */
export function Toast({
  id,
  agent,
  text,
  onUndo,
  onDismiss,
}: {
  id: number;
  agent: AgentInfo;
  text: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const t = useMessages(agentsMessages);
  useEffect(() => {
    const timer = setTimeout(onDismiss, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-20 flex min-h-10 -translate-x-1/2 items-center gap-2 rounded-lg bg-fg py-1 pr-2 pl-3 text-body whitespace-nowrap text-on-fill"
    >
      <Character look={agent.look} color={agent.color} size={24} label="" />
      <span>{text}</span>
      <button
        type="button"
        onClick={onUndo}
        className="min-h-7 cursor-pointer rounded-md px-2 font-medium hover:bg-on-fill/20"
      >
        {t.undo}
      </button>
    </div>
  );
}
