import { createFileRoute } from '@tanstack/react-router';

import { WorkspaceDock } from '@/app/WorkspaceDock';
import { showDockTab } from '@/features/dock/state';
import { Session } from '@/features/session/Session';
import { useWorkResultTab } from '@/features/work-result/useWorkResultTab';
import { useSession } from '@/shared/server';

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
  const session = useSession(sessionId);
  const cwd = session.data?.info.cwd;
  if (!cwd) return <Session key={sessionId} sessionId={sessionId} />;
  return (
    <WorkspaceDock cwd={cwd} sessionId={sessionId} scope={`session:${sessionId}`} tabs={[resultTab]}>
      <Session key={sessionId} sessionId={sessionId} onInspectProcesses={() => showDockTab('processes')} />
    </WorkspaceDock>
  );
}
