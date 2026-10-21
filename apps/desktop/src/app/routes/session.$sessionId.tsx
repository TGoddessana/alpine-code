import { createFileRoute } from '@tanstack/react-router';

import { CHANGES_TAB, SUMMARY_TAB, WorkspaceDock } from '@/app/WorkspaceDock';
import { showDockTab } from '@/features/dock/state';
import { RecordItems } from '@/features/session/RecordItems';
import { Session } from '@/features/session/Session';
import { useTaskForceTab } from '@/features/taskforce/useTaskForceTab';
import { WorkSummary } from '@/features/work-result/WorkSummary';
import { useWorkResultTab } from '@/features/work-result/useWorkResultTab';
import { useSession, type Item } from '@/shared/server';

/**
 * A session exists: the chat with the input at the bottom, and the right dock beside it. The dock is closed until I
 * open it from the top bar, where its button counts the changed files meanwhile.
 */
export const Route = createFileRoute('/session/$sessionId')({
  component: SessionRoute,
});

function renderRecord(items: Item[]) {
  return <RecordItems items={items} />;
}

function SessionRoute() {
  const { sessionId } = Route.useParams();
  const resultTab = useWorkResultTab(sessionId);
  const taskForceTab = useTaskForceTab(sessionId, renderRecord);
  const session = useSession(sessionId);
  const cwd = session.data?.info.cwd;
  if (!cwd) return <Session key={sessionId} sessionId={sessionId} />;
  return (
    <WorkspaceDock
      cwd={cwd}
      sessionId={sessionId}
      scope={`session:${sessionId}`}
      // A TF's agents are the summary of a TF session; otherwise what the work touched.
      summary={
        taskForceTab ? (
          taskForceTab.content
        ) : (
          <WorkSummary sessionId={sessionId} onOpenChanges={() => showDockTab(CHANGES_TAB)} />
        )
      }
      changes={resultTab}
    >
      <Session
        key={sessionId}
        sessionId={sessionId}
        onInspectProcesses={() => showDockTab('processes')}
        onShowTaskForce={() => showDockTab(SUMMARY_TAB)}
      />
    </WorkspaceDock>
  );
}
