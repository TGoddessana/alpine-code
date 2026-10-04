import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';

import { Session } from '@/features/session/Session';
import { useWorkResultOpen } from '@/features/work-result/PanelToggle';
import { workResult } from '@/features/work-result/results';
import { WorkResult } from '@/features/work-result/WorkResult';
import { useSession } from '@/shared/server';

/**
 * A session exists: the chat with the input at the bottom. The work result panel is closed until I open it from
 * the top bar, where its button counts the changed files meanwhile.
 */
export const Route = createFileRoute('/session/$sessionId')({
  component: SessionRoute,
});

function SessionRoute() {
  const { sessionId } = Route.useParams();
  const session = useSession(sessionId);
  const [open, setOpen] = useWorkResultOpen();
  const items = session.data?.items;
  const result = useMemo(() => workResult(items ?? []), [items]);
  return (
    <>
      <Session key={sessionId} sessionId={sessionId} />
      {open && <WorkResult result={result} onClose={() => setOpen(false)} />}
    </>
  );
}
