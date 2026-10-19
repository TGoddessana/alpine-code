import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { DataPanel } from '@/features/data/DataPanel';
import { DevelopmentServers } from '@/features/development-servers';
import { DockLayout, type DockTab } from '@/features/dock/Dock';
import { showDockTab, useDockOpen } from '@/features/dock/state';
import { FileViewer } from '@/features/file-viewer';
import { ProcessControl } from '@/features/process-control';
import { Terminal } from '@/features/terminal';
import { FileNavigationProvider } from '@/shared/files';
import { useMessages } from '@/shared/i18n';
import { useDataSources } from '@/shared/server';
import { useDevelopmentServers } from '@/shared/server/devServers';

import { messages } from './messages';

/** App-level composition keeps file links and the running project's tools on the same workspace. */
export function WorkspaceDock({
  cwd,
  sessionId,
  scope,
  tabs,
  children,
}: {
  cwd: string;
  sessionId?: string;
  scope: string;
  tabs: DockTab[];
  children: ReactNode;
}) {
  const t = useMessages(messages);
  const client = useQueryClient();
  const [dockOpen] = useDockOpen();
  const servers = useDevelopmentServers(cwd, dockOpen);
  const [requestedServers, setRequestedServers] = useState<Record<string, boolean>>({});
  const hasData = useDataSources(cwd, dockOpen).data?.sources.some((source) => source.available) ?? false;
  const hasServers = Boolean(servers.data?.servers.length);
  const showServers = hasServers || requestedServers[cwd];
  const openServers = () => {
    setRequestedServers((current) => ({ ...current, [cwd]: true }));
    showDockTab('servers');
  };
  return (
    <FileNavigationProvider
      key={cwd}
      cwd={cwd}
      onOpen={() => showDockTab('source')}
      onReturnToChanges={() => showDockTab('work-result')}
    >
      <DockLayout
        scope={scope}
        tabs={[
          ...tabs,
          ...(hasData ? [{ id: 'data', label: t.data, bare: true, content: <DataPanel key={cwd} cwd={cwd} /> }] : []),
          { id: 'source', label: t.source, content: <FileViewer /> },
          {
            id: 'terminal',
            label: t.terminal,
            bare: true,
            content: <Terminal key={cwd} cwd={cwd} sessionId={sessionId} onOpenDevelopmentServer={openServers} />,
          },
          ...(showServers
            ? [
                {
                  id: 'servers',
                  label: t.servers,
                  bare: true,
                  content: (
                    <DevelopmentServers
                      key={cwd}
                      cwd={cwd}
                      sessionId={sessionId}
                      onDismiss={
                        hasServers
                          ? undefined
                          : () => {
                              setRequestedServers((current) => ({ ...current, [cwd]: false }));
                              showDockTab('terminal');
                            }
                      }
                    />
                  ),
                },
              ]
            : []),
          {
            id: 'processes',
            label: t.processes,
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
