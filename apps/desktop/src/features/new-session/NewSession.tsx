import type { ProjectInfo } from '@alpine/protocol';
import { Button, Menu } from '@alpine/ui/primitives';
import { useRef, useState } from 'react';

import { AgentChip, Composer, type Mode } from '@/shared/components/composer';
import { GitBar } from '@/shared/components/git';
import { useMessages } from '@/shared/i18n';
import { useOpenFolder } from '@/shared/platform';
import { useAgents, useConnections, useNewSession, useSendMessage, useSettings } from '@/shared/server';

import { CloneDialog } from './CloneDialog';
import { ExampleCards } from './ExampleCards';
import { messages } from './messages';

const DEFAULT_AGENT = 'default';

/**
 * Board NewSession: pick the project over the input, then type. No header and no work result panel yet: they belong to
 * a session and appear with the first message, while the input stays where it is.
 *
 * Sending starts the session in the project's folder with the shown agent, sends the message, and calls `onStarted`
 * with the new session's id so the app can show it. The agent is the one picked in its chip for this project, else
 * `agent` (from the address), else the one the project used last, else the default agent. The session starts in the
 * default permission mode (Settings › General) unless one is picked in the chip, which counts for this session only.
 */
export function NewSession({
  projects,
  project,
  agent,
  onProjectChange,
  onStarted,
}: {
  projects: ProjectInfo[];
  project: ProjectInfo;
  /** The agent to start with, unless one is picked here for this project. */
  agent?: string;
  onProjectChange: (path: string) => void;
  onStarted: (sessionId: string) => void;
}) {
  const t = useMessages(messages);
  const defaultModel = useConnections().data?.defaultModel;
  const newSession = useNewSession();
  const sendMessage = useSendMessage();
  // A session made for a message that then failed to send is used again on retry (with the same agent), not made twice.
  const made = useRef<{ path: string; agent: string | null; id: string } | null>(null);
  const openFolder = useOpenFolder(onProjectChange);
  const [cloning, setCloning] = useState(false);
  // An agent picked in the chip, for this project only.
  const [picked, setPicked] = useState<{ path: string; id: string } | null>(null);
  const agents = useAgents().data?.agents;
  const [prefill, setPrefill] = useState({ text: '', key: 0 });
  const defaultMode = useSettings().data?.mode;
  const [mode, setMode] = useState<Mode | null>(null);
  const shownMode = mode ?? defaultMode;
  const wanted = (picked?.path === project.path ? picked.id : null) ?? agent ?? project.lastAgent ?? DEFAULT_AGENT;
  // Until the agents are read (or when they cannot be), no agent is sent, so the server applies its own choice
  // (the project's last agent, then the default) rather than the app forcing the default one.
  const known = agents?.some((a) => a.id === wanted) ?? false;
  const shown = known ? wanted : DEFAULT_AGENT;
  const sent = known ? wanted : null;
  const shownAgent = agents?.find((a) => a.id === shown);

  const start = async (text: string) => {
    if (made.current?.path !== project.path || made.current.agent !== sent) {
      const info = await newSession.mutateAsync({
        cwd: project.path,
        ...(sent ? { agent: sent } : {}),
        ...(mode ? { mode } : {}),
      });
      made.current = { path: project.path, agent: sent, id: info.id };
    }
    const { id } = made.current;
    await sendMessage.mutateAsync({ sessionId: id, text });
    made.current = null;
    setMode(null);
    onStarted(id);
  };

  return (
    <main aria-label={t.newSession} className="flex min-w-120 grow flex-col bg-canvas">
      <div className="min-h-0 grow" />
      <div className="mx-auto flex w-full max-w-160 flex-col items-center gap-6 px-6 pb-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-display font-semibold">{t.heading}</h1>
          <p className="text-body text-fg-muted">{t.lead(project.name)}</p>
        </div>
        <ExampleCards onPick={(text) => setPrefill((last) => ({ text, key: last.key + 1 }))} />
      </div>
      <div className="mx-auto flex w-full max-w-202 flex-col gap-2 px-6 pt-3 pb-6">
        <div className="flex min-w-0 items-center gap-3">
          <Menu.Root>
            <Menu.Trigger render={<Button />} aria-label={`${t.project}: ${project.name}`} title={project.path}>
              {project.name}
              <span aria-hidden="true">›</span>
            </Menu.Trigger>
            <Menu.Popup side="top" className="w-60">
              <Menu.RadioGroup value={project.path} onValueChange={(path: string) => onProjectChange(path)}>
                {projects.map((p) => (
                  <Menu.RadioItem key={p.path} value={p.path}>
                    <span className="min-w-0 grow truncate">{p.name}</span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
              <Menu.Separator />
              <Menu.Item onClick={openFolder}>
                <span className="grow">{t.openFolderItem}</span>
                <span className="text-meta text-fg-muted">⌘O</span>
              </Menu.Item>
              <Menu.Item onClick={() => setCloning(true)}>{t.cloneItem}</Menu.Item>
            </Menu.Popup>
          </Menu.Root>
          <GitBar path={project.path} />
        </div>
        <Composer
          onSend={start}
          prefill={prefill}
          mode={shownMode ? { value: shownMode, onChange: setMode } : undefined}
          agent={
            <AgentChip
              context="new"
              agentId={shown}
              model={shownAgent?.model ?? defaultModel ?? null}
              lastUsed={project.lastAgent}
              onChange={(id) => setPicked({ path: project.path, id })}
            />
          }
        />
      </div>
      <CloneDialog open={cloning} onOpenChange={setCloning} onCloned={onProjectChange} />
    </main>
  );
}
