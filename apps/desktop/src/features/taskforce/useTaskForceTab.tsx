import type { TaskForceItem } from '@alpine/protocol';
import { useState, type ReactNode } from 'react';

import { latestTaskForce, taskForceMessages } from '@/shared/components/taskforce';
import { useMessages } from '@/shared/i18n';
import { useSession, type Item } from '@/shared/server';

import { AgentsTab } from './AgentsTab';

export const TASKFORCE_TAB = 'taskforce';

/**
 * The dock's TF tab for a session that has a TF (its latest one), or `null`. `renderRecord` draws what one agent did
 * (the session's way of drawing items, which the app hands in).
 */
export function useTaskForceTab(sessionId: string, renderRecord: (items: Item[]) => ReactNode) {
  const t = useMessages(taskForceMessages);
  const session = useSession(sessionId);
  const item = session.data ? latestTaskForce(session.data.items) : null;
  if (!item || item.status === 'declined') return null;
  return {
    id: TASKFORCE_TAB,
    label: t.name,
    content: <TaskForceTab key={item.id} sessionId={sessionId} item={item} renderRecord={renderRecord} />,
  };
}

function TaskForceTab({
  sessionId,
  item,
  renderRecord,
}: {
  sessionId: string;
  item: TaskForceItem;
  renderRecord: (items: Item[]) => ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <AgentsTab
      sessionId={sessionId}
      item={item}
      selected={selected}
      onSelect={setSelected}
      renderRecord={renderRecord}
    />
  );
}
