import { createFileRoute } from '@tanstack/react-router';

import { Session } from '@/features/session/Session';
import { StatusPanel } from '@/features/status-panel/StatusPanel';

/** A session exists, so its header and the right panel show; the input stays at the bottom. */
export const Route = createFileRoute('/session/$sessionId')({
  component: SessionRoute,
});

function SessionRoute() {
  const { sessionId } = Route.useParams();
  return (
    <>
      <Session key={sessionId} sessionId={sessionId} />
      <StatusPanel />
    </>
  );
}
