import { useEffect, useRef } from 'react';

import { AgentChip, Composer } from '@/shared/components/composer';
import { useMessages } from '@/shared/i18n';
import {
  activeApproval,
  SESSION_NOT_FOUND,
  SESSION_RUNNING,
  ServerError,
  useAnswerApproval,
  useCancelSession,
  useSendMessage,
  useSession,
  useSetSessionAgent,
  useSetSessionMode,
} from '@/shared/server';

import { Chat } from './Chat';
import { ContextMeter } from './ContextMeter';
import { ProgressLine } from './ProgressLine';
import { messages } from './messages';

/** Within this many pixels of the end, the chat follows new text; further up, the reader is left where they are. */
const FOLLOW_PX = 80;

/**
 * A session's centre column: the chat ending in the progress line while a run is
 * active (a call that waits for my answer is a card in it), and the input at the bottom (with the conversation
 * length meter in its bar, the agent chip, which hands the conversation to another agent between messages (it waits
 * while a run goes on), and the permission mode, which can change any time and counts from the next call: a call
 * already waiting stays). While the run goes on the send button is a stop button. While a call waits, what I write in the input skips
 * it and tells the agent what to do instead. Project, branch and state are in the top bar.
 */
export function Session({ sessionId }: { sessionId: string }) {
  const t = useMessages(messages);
  const session = useSession(sessionId);
  const send = useSendMessage();
  const cancel = useCancelSession();
  const answer = useAnswerApproval();
  const setMode = useSetSessionMode();
  const setAgent = useSetSessionAgent();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const state = session.data;
  const shown = Boolean(state && !state.deleted);

  // Follow the end of the chat as it grows, unless the reader scrolled up. The chat's height is watched rather than
  // the items, because a reply keeps growing on screen after its text arrived (it is let out at an even pace).
  useEffect(() => {
    const element = scroller.current;
    if (!element || !content.current) return;
    const observer = new ResizeObserver(() => {
      if (following.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [shown]);

  if (!state || state.deleted) {
    const missing =
      state?.deleted || (session.error instanceof ServerError && session.error.code === SESSION_NOT_FOUND);
    return (
      <main aria-label={t.conversation} className="flex min-w-120 grow flex-col items-center justify-center bg-canvas">
        {(missing || session.isError) && (
          <p role="status" className="text-body text-fg-muted">
            {missing ? t.notFound : t.loadFailed}
          </p>
        )}
      </main>
    );
  }

  const { info } = state;
  const running = info.status === 'running' || info.status === 'waiting';
  const approval = activeApproval(state);
  const title = info.title || t.untitled;
  const agentError = setAgent.error;
  const agentFailed =
    agentError instanceof ServerError && agentError.code === SESSION_RUNNING
      ? t.agentRunning
      : agentError instanceof ServerError && agentError.data?.reason === 'invalid_config'
        ? t.agentInvalidConfig
        : agentError instanceof ServerError && agentError.data?.reason === 'agent_not_found'
          ? t.agentNotFound
          : t.agentFailed;

  return (
    <main aria-label={title} className="flex min-w-120 grow flex-col bg-canvas">
      <div
        ref={scroller}
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          following.current = scrollHeight - scrollTop - clientHeight < FOLLOW_PX;
        }}
        className="min-h-0 grow overflow-y-auto"
      >
        <div ref={content} className="mx-auto flex w-full max-w-175 flex-col gap-4 px-6 py-6">
          <Chat sessionId={sessionId} cwd={info.cwd} items={state.items} activeIds={state.activeIds} />
          {running && <ProgressLine info={info} />}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-175 flex-col gap-2 px-6 pt-3 pb-6">
        {setAgent.isError && (
          <p role="alert" className="px-1 text-meta text-fg-muted">
            {agentFailed}
          </p>
        )}
        <Composer
          running={running}
          answer={
            approval
              ? {
                  placeholder: t.answerPlaceholder,
                  onSend: (text) =>
                    answer.mutateAsync({ sessionId, requestId: approval.id, decision: 'deny', feedback: text }),
                }
              : undefined
          }
          agent={
            <AgentChip
              context="session"
              agentId={info.agent ?? 'default'}
              model={info.model}
              disabled={running || setAgent.isPending}
              onChange={(agent) => setAgent.mutate({ sessionId, agent })}
            />
          }
          bar={<ContextMeter info={info} />}
          onSend={(text) => {
            following.current = true;
            return send.mutateAsync({ sessionId, text });
          }}
          onStop={() => cancel.mutate(sessionId)}
          mode={{ value: info.mode, onChange: (mode) => setMode.mutate({ sessionId, mode }) }}
        />
      </div>
    </main>
  );
}
