import { createFileRoute } from '@tanstack/react-router';

import { DockLayout } from '@/features/dock/Dock';
import { Session } from '@/features/session/Session';
import { useWorkResultTab } from '@/features/work-result/useWorkResultTab';

/**
 * A session exists: the chat with the input at the bottom, and the right dock beside it. The dock is closed until I
 * open it from the top bar, where its button counts the changed files meanwhile.
 */
export const Route = createFileRoute('/session/$sessionId')({
  component: SessionRoute,
});

function SessionRoute() {
  const { sessionId } = Route.useParams();
  const resultTab = useWorkResultTab(sessionId);
  return (
    <DockLayout scope={`session:${sessionId}`} tabs={[resultTab]}>
      <Session key={sessionId} sessionId={sessionId} />
    </DockLayout>
  );
}
