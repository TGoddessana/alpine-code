import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { DockLayout, type DockTab } from '@/features/dock/Dock';
import { messages as dockMessages } from '@/features/dock/messages';
import { showDockTab, useDockExpanded, useDockOpen } from '@/features/dock/state';
import { ProductMap } from '@/features/product-map/ProductMap';
import { Session } from '@/features/session/Session';
import { useWorkResultTab } from '@/features/work-result/useWorkResultTab';
import { useMessages } from '@/shared/i18n';
import { useProjects, useSession } from '@/shared/server';

export const Route = createFileRoute('/board')({
  validateSearch: (search: Record<string, unknown>): { project?: string; session?: string } => ({
    ...(typeof search.project === 'string' ? { project: search.project } : {}),
    ...(typeof search.session === 'string' ? { session: search.session } : {}),
  }),
  component: BoardRoute,
});

/** The dock tab that holds the map's agent session. */
const CONVERSATION_TAB = 'conversation';

function BoardRoute() {
  const { project: chosen, session } = Route.useSearch();
  const projects = useProjects();
  const navigate = useNavigate();
  const attached = useSession(session ?? null);
  const [dockOpen] = useDockOpen();
  const scope = `board:${chosen ?? ''}`;
  const [expanded] = useDockExpanded(scope);
  const resultTab = useWorkResultTab(session ?? null, chosen);
  const t = useMessages(dockMessages);
  const project = projects.data?.projects.find((p) => p.path === chosen && !p.archived);
  const attachedHere = !!session && !!attached.data && attached.data.info.cwd === chosen && !attached.data.deleted;
  // The map's agent session lives in the dock, beside its work result: one place for the conversation on every page.
  const tabs: DockTab[] = attachedHere
    ? [
        {
          id: CONVERSATION_TAB,
          label: t.conversation,
          bare: true,
          content: <Session key={session} sessionId={session} compact />,
        },
        resultTab,
      ]
    : [resultTab];
  if (!project) return <div className="p-8 text-body text-fg-muted">{projects.isLoading ? '…' : (chosen ?? '—')}</div>;
  return (
    <DockLayout scope={scope} tabs={tabs}>
      <ProductMap
        key={project.path}
        cwd={project.path}
        sessionId={session ?? null}
        dockOpen={dockOpen}
        hidden={expanded}
        demo={!('__TAURI_INTERNALS__' in window)}
        onShowConversation={() => showDockTab(CONVERSATION_TAB)}
        onSession={(id) =>
          void navigate({ to: '/board', search: { project: project.path, session: id }, replace: true })
        }
      />
    </DockLayout>
  );
}
