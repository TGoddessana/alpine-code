import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { DevelopmentServers } from '@/features/development-servers';
import { DockLayout, type DockTab } from '@/features/dock/Dock';
import { showDockTab } from '@/features/dock/state';
import { FileViewer } from '@/features/file-viewer';
import { ProcessControl } from '@/features/process-control';
import { Terminal } from '@/features/terminal';
import { FileNavigationProvider } from '@/shared/files';
import { useMessages } from '@/shared/i18n';

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
  return (
    <FileNavigationProvider key={cwd} cwd={cwd} onOpen={() => showDockTab('source')}>
      <DockLayout
        scope={scope}
        tabs={[
          ...tabs,
          { id: 'source', label: t.source, content: <FileViewer /> },
          {
            id: 'terminal',
            label: t.terminal,
            bare: true,
            content: <Terminal key={cwd} cwd={cwd} sessionId={sessionId} />,
          },
          {
            id: 'servers',
            label: t.servers,
            bare: true,
            content: <DevelopmentServers key={cwd} cwd={cwd} sessionId={sessionId} />,
          },
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
