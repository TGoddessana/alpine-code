import { useEffect, useRef } from 'react';

import { Composer, SessionProfile } from '@/shared/components/composer';
import { PlanLine } from '@/shared/components/connect';
import { StatusWord } from '@/shared/components/status';
import { useMessages } from '@/shared/i18n';
import {
  activeApproval,
  SESSION_NOT_FOUND,
  ServerError,
  useCancelSession,
  useProjects,
  useSendMessage,
  useSession,
} from '@/shared/server';

import { ApprovalDock } from './ApprovalDock';
import { Chat } from './Chat';
import { ContextMeter } from './ContextMeter';
import { ProgressLine } from './ProgressLine';
import { messages } from './messages';

/** Within this many pixels of the end, the chat follows new text; further up, the reader is left where they are. */
const FOLLOW_PX = 80;

/**
 * A session's centre column: the header (title · project, state), the chat ending in the progress line while a run is
 * active, the approval dock while one waits, and the input at the bottom (with the memory meter in its bar). While
 * the run goes on the send button is a stop button.
 */
export function Session({ sessionId }: { sessionId: string }) {
  const t = useMessages(messages);
  const session = useSession(sessionId);
  const projects = useProjects();
  const send = useSendMessage();
  const cancel = useCancelSession();
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
  const project = projects.data?.projects.find((p) => p.path === info.cwd)?.name ?? info.cwd.split('/').pop();
  const running = info.status === 'running' || info.status === 'waiting';
  const approval = activeApproval(state);
  const title = info.title || t.untitled;

  return (
    <main aria-label={title} className="flex min-w-120 grow flex-col bg-canvas">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <h1 className="min-w-0 truncate text-title" title={title}>
          {title}
        </h1>
        <span className="shrink-0 text-meta text-fg-muted" title={info.cwd}>
          · {project}
        </span>
        <span className="grow" />
        <StatusWord status={info.status} />
      </header>
      <div
        ref={scroller}
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          following.current = scrollHeight - scrollTop - clientHeight < FOLLOW_PX;
        }}
        className="min-h-0 grow overflow-y-auto"
      >
        <div ref={content} className="mx-auto flex w-full max-w-202 flex-col gap-4 px-6 py-6">
          <Chat items={state.items} activeIds={state.activeIds} />
          {running && <ProgressLine info={info} />}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-202 flex-col gap-2 px-6 pt-3 pb-6">
        {approval && <ApprovalDock key={approval.id} sessionId={sessionId} approval={approval} />}
        <div className="flex justify-end empty:hidden">
          <PlanLine model={info.model} />
        </div>
        <Composer
          running={running}
          bar={
            <>
              <ContextMeter info={info} />
              <SessionProfile profileId={info.profile} />
              <span aria-label={t.model(info.model)} title={info.model} className="px-2 text-meta text-fg-muted">
                {info.model.slice(info.model.indexOf('/') + 1)}
              </span>
            </>
          }
          onSend={(text) => {
            following.current = true;
            return send.mutateAsync({ sessionId, text });
          }}
          onStop={() => cancel.mutate(sessionId)}
        />
      </div>
    </main>
  );
}
