import type { CloneInfo, ProjectInfo } from '@alpine/protocol';
import { useRef, useState } from 'react';

import { BrandMark } from '@/shared/components/brand';

import { AgentChip, Composer, useSlashSkills, type Mode } from '@/shared/components/composer';
import { CloneDialog, projectAddMessages } from '@/shared/components/project-add';
import { useMessages } from '@/shared/i18n';
import { useAgents, useCancelClone, useConnections, useNewSession, useSendMessage, useSettings } from '@/shared/server';

import { ImportLink } from './ImportLink';
import { messages } from './messages';
import { Receiving } from './Receiving';
import { Suggestions } from './Suggestions';

const DEFAULT_AGENT = 'default';

/**
 * Board NewSession: type, pick one of three suggestions, or go on with a conversation another app (Claude Code, Codex,
 * …) had in the project. The project is the one the rail shows; it is picked there, not here. No header and no work
 * result panel yet: they belong to a session and appear with the first message, while the input stays where it is
 * (as wide as in the session).
 *
 * Sending starts the session in the project's folder with the shown agent, sends the message, and calls `onStarted`
 * with the new session's id so the app can show it. The agent is the one picked in its chip for this project, else
 * `agent` (from the address), else the one the project used last, else the default agent. The session starts in the
 * default permission mode (Settings › General) unless one is picked in the chip, which counts for this session only.
 *
 * While the project is still being received (`clone`), the centre shows how far it got and the input takes text but
 * does not send; when it arrives the screen is the usual one, with the text still there.
 */
export function NewSession({
  project,
  agent,
  clone,
  onProjectChange,
  onStarted,
}: {
  project: ProjectInfo;
  /** The project's clone, while it is on its way or after it failed. */
  clone?: CloneInfo;
  /** The agent to start with, unless one is picked here for this project. */
  agent?: string;
  /** `null`: no project picked (back to the most recent one). */
  onProjectChange: (path: string | null) => void;
  onStarted: (sessionId: string) => void;
}) {
  const slash = useSlashSkills(project.path);
  const t = useMessages(messages);
  const added = useMessages(projectAddMessages);
  const cancelClone = useCancelClone();
  const [retrying, setRetrying] = useState<string | null>(null);
  const defaultModel = useConnections().data?.defaultModel;
  const newSession = useNewSession();
  const sendMessage = useSendMessage();
  // A session made for a message that then failed to send is used again on retry (with the same agent), not made twice.
  const made = useRef<{ path: string; agent: string | null; id: string } | null>(null);
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
      <div className="mx-auto flex w-full max-w-175 flex-col items-center gap-6 px-6">
        {clone ? (
          <Receiving
            clone={clone}
            onCancel={() => cancelClone.mutate(clone.id, { onSuccess: () => onProjectChange(null) })}
            onDismiss={() => cancelClone.mutate(clone.id, { onSuccess: () => onProjectChange(null) })}
            onRetry={() => setRetrying(clone.address)}
          />
        ) : (
          <>
            <div className="flex flex-col items-center gap-3 text-center">
              <BrandMark size={56} />
              <h1 className="text-display font-semibold">{t.heading}</h1>
            </div>
            <div className="flex w-full flex-col gap-2">
              <Suggestions onPick={(text) => setPrefill((last) => ({ text, key: last.key + 1 }))} />
              <ImportLink cwd={project.path} onOpen={onStarted} />
            </div>
          </>
        )}
      </div>
      <div className="min-h-0 grow" />
      <div className="mx-auto w-full max-w-175 px-6 pt-3 pb-6">
        <Composer
          placeholder={t.placeholder}
          locked={clone?.state === 'failed'}
          waiting={clone?.state === 'receiving' ? added.waitToSend : undefined}
          onSend={start}
          slash={slash}
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
      <CloneDialog
        open={retrying !== null}
        address={retrying ?? undefined}
        onOpenChange={(open) => !open && setRetrying(null)}
        onDone={(path) => {
          setRetrying(null);
          if (clone) cancelClone.mutate(clone.id); // the failed one makes way for the new try
          onProjectChange(path);
        }}
      />
    </main>
  );
}
