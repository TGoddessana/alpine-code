import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { SUMMARY_TAB, WorkspaceDock } from '@/app/WorkspaceDock';
import { messages as dockMessages } from '@/features/dock/messages';
import { showDockTab, useDockExpanded, useDockOpen } from '@/features/dock/state';
import { ProductMap } from '@/features/product-map/ProductMap';
import { Session } from '@/features/session/Session';
import { useWorkResultTab } from '@/features/work-result/useWorkResultTab';
import { useMessages } from '@/shared/i18n';
import { useProjects, useSession, useSessions } from '@/shared/server';

export const Route = createFileRoute('/board')({
  validateSearch: (search: Record<string, unknown>): { project?: string; session?: string } => ({
    ...(typeof search.project === 'string' ? { project: search.project } : {}),
    ...(typeof search.session === 'string' ? { session: search.session } : {}),
  }),
  component: BoardRoute,
});

function BoardRoute() {
  const { project: chosen, session: asked } = Route.useSearch();
  const projects = useProjects();
  // Without one in the address, the map shows its project's own conversation (map work all goes on in one).
  const sessions = useSessions().data;
  const session =
    asked ?? sessions?.find((s) => s.cwd === chosen && s.purpose === 'map' && !s.archived)?.id ?? undefined;
  const navigate = useNavigate();
  const attached = useSession(session ?? null);
  const [dockOpen] = useDockOpen();
  const scope = `board:${chosen ?? ''}`;
  const [expanded] = useDockExpanded(scope);
  const resultTab = useWorkResultTab(session ?? null, chosen);
  const t = useMessages(dockMessages);
  const project = projects.data?.projects.find((p) => p.path === chosen && !p.archived);
  const attachedHere = !!session && !!attached.data && attached.data.info.cwd === chosen && !attached.data.deleted;
  // The map's agent session is its summary, in the dock: one place for the conversation on every page.
  const summary = attachedHere ? (
    <Session key={session} sessionId={session} compact onInspectProcesses={() => showDockTab('processes')} />
  ) : (
    <p className="px-5 text-body text-fg-muted">{t.mapSummaryEmpty}</p>
  );
  if (!project) return <div className="p-8 text-body text-fg-muted">{projects.isLoading ? '…' : (chosen ?? '—')}</div>;
  return (
    <WorkspaceDock
      cwd={project.path}
      sessionId={attachedHere ? session : undefined}
      scope={scope}
      summary={summary}
      changes={resultTab}
      showMap={false}
    >
      <ProductMap
        key={project.path}
        cwd={project.path}
        sessionId={session ?? null}
        dockOpen={dockOpen}
        hidden={expanded}
        demo={!('__TAURI_INTERNALS__' in window)}
        onShowConversation={() => showDockTab(SUMMARY_TAB)}
        onSession={(id) =>
          void navigate({ to: '/board', search: { project: project.path, session: id }, replace: true })
        }
      />
    </WorkspaceDock>
  );
}
