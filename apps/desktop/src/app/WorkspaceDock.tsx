import { useNavigate } from '@tanstack/react-router';
import { Database, Diff, Folder, Globe, LayoutList, ListChecks, SquareTerminal } from 'lucide-react';
import { type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { DataPanel } from '@/features/data/DataPanel';
import { DevelopmentServers } from '@/features/development-servers';
import { DockLayout, type DockTab } from '@/features/dock/Dock';
import { showDockTab, useDockOpen } from '@/features/dock/state';
import { MiniMap } from '@/features/product-map/MiniMap';
import { FileViewer } from '@/features/file-viewer';
import { ProcessControl } from '@/features/process-control';
import { Terminal } from '@/features/terminal';
import { FileNavigationProvider } from '@/shared/files';
import { useMessages } from '@/shared/i18n';
import { useCloudEnabled, useDataSources } from '@/shared/server';

import { messages } from './messages';

/** The dock tab ids pages and features ask for with `showDockTab`. */
export const SUMMARY_TAB = 'summary';
export const CHANGES_TAB = 'work-result';

/**
 * App-level composition keeps file links and the running project's tools on the same workspace. The dock is one row
 * of icons: 요약 (what the page hands in), then 터미널, 변경 사항, 미리보기, 파일, and under ⋮ the rarer places
 * (데이터, 에이전트 실행). Away from the map, the project's map stays small above them.
 */
export function WorkspaceDock({
  cwd,
  sessionId,
  scope,
  summary,
  changes,
  showMap = true,
  children,
}: {
  cwd: string;
  sessionId?: string;
  scope: string;
  /** What 요약 shows on this page. */
  summary: ReactNode;
  /** The 변경 사항 tab (the work result), which stays mounted. */
  changes: DockTab;
  /** False on the map itself, where a small copy of it would only repeat the page. */
  showMap?: boolean;
  children: ReactNode;
}) {
  const t = useMessages(messages);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [dockOpen] = useDockOpen();
  // The 데이터 place is Alpine Cloud's: without it the place is not there and the sources are not even asked for.
  const cloud = useCloudEnabled();
  const hasData = useDataSources(cwd, dockOpen && cloud).data?.sources.some((source) => source.available) ?? false;
  return (
    <FileNavigationProvider
      key={cwd}
      cwd={cwd}
      onOpen={() => showDockTab('source')}
      onReturnToChanges={() => showDockTab(CHANGES_TAB)}
    >
      <DockLayout
        scope={scope}
        top={
          showMap ? (
            <MiniMap cwd={cwd} onOpen={() => void navigate({ to: '/board', search: { project: cwd } })} />
          ) : undefined
        }
        tabs={[
          { id: SUMMARY_TAB, label: t.summary, icon: LayoutList, divider: true, bare: true, content: summary },
          {
            id: 'terminal',
            label: t.terminal,
            icon: SquareTerminal,
            bare: true,
            content: (
              <Terminal
                key={cwd}
                cwd={cwd}
                sessionId={sessionId}
                onOpenDevelopmentServer={() => showDockTab('servers')}
              />
            ),
          },
          { ...changes, icon: Diff },
          {
            id: 'servers',
            label: t.preview,
            icon: Globe,
            bare: true,
            content: <DevelopmentServers key={cwd} cwd={cwd} sessionId={sessionId} />,
          },
          { id: 'source', label: t.source, icon: Folder, content: <FileViewer /> },
          ...(hasData
            ? [
                {
                  id: 'data',
                  label: t.data,
                  icon: Database,
                  more: true,
                  bare: true,
                  content: <DataPanel key={cwd} cwd={cwd} />,
                },
              ]
            : []),
          {
            id: 'processes',
            label: t.processes,
            icon: ListChecks,
            more: true,
            bare: true,
            content: (
              <ProcessControl
                key={`${cwd}:${sessionId ?? ''}`}
                cwd={cwd}
                sessionId={sessionId}
                onInspectProcess={(processId) => {
                  client.setQueryData(['terminal-selection', cwd], processId);
                  showDockTab('terminal');
                }}
              />
            ),
          },
        ]}
      >
        {children}
      </DockLayout>
    </FileNavigationProvider>
  );
}
