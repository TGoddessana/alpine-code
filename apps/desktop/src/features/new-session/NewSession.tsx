import type { CloneInfo, CloudStatus, JudgedNew, ProjectInfo } from '@alpine/protocol';
import { AutoHeight, Button, Dialog, LinkButton } from '@alpine/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AlpineSignIn, NodeInstall, UpgradeSheet } from '@/shared/components/cloud';
import { AgentChip, Composer, useSlashSkills, type Mode } from '@/shared/components/composer';
import { CloneDialog, projectAddMessages } from '@/shared/components/project-add';
import { Snowscape } from '@/shared/components/snowscape';
import { useLocale, useMessages } from '@/shared/i18n';
import {
  ServerError,
  useAgents,
  useCancelClone,
  cloudKey,
  useCloudStatus,
  useConnections,
  useCreateProject,
  useJudgeNewProject,
  useNewSession,
  useNodeTools,
  useSendMessage,
  useSettings,
  type CreateStep,
  type Judgement,
  type TemplateId,
} from '@/shared/server';

import { Creating, type CreateFailure } from './Creating';
import { ImportLink } from './ImportLink';
import { messages } from './messages';
import { ProjectChip } from './ProjectChip';
import { Receiving } from './Receiving';
import { TemplateCards, useTemplates } from './TemplateCards';

const DEFAULT_AGENT = 'default';

/**
 * After sending: the agent judging it, then (for a new app) its pick of a setup, then the project being made. `judged`
 * is that pick; it is `null` when making a new project and the agent gave none (it said work on a project, or could
 * not be asked), so the setups show with the usual one chosen and nobody recommending it.
 */
type Stage =
  | { name: 'judging'; text: string }
  | { name: 'choosing'; text: string; judged: JudgedNew | null; template: TemplateId }
  | CreatingStage;

/** The setup chosen when the agent gave no pick. */
const FALLBACK_TEMPLATE: TemplateId = 'web-lite';

/** What stands between 만들기 and making the project: the Alpine account and Pro (a realtime web app), or Node.js (any web app). */
type Gate = { kind: 'sign-in' | 'upgrade' | 'node'; chosen: Extract<Stage, { name: 'choosing' }> };

interface CreatingStage {
  name: 'creating';
  text: string;
  judged: JudgedNew | null;
  template: TemplateId;
  /** The steps the server has announced, and the project they are about. */
  steps: CreateStep[];
  project: ProjectInfo | null;
  /** The web address the server made, once it says so. */
  address: string | null;
  outcome: { status: 'working' } | { status: 'done'; sessionId: string } | { status: 'failed'; error: unknown };
}

/** What a rejected `projects/create` means for the person: nothing made, or the project made without the AI started. */
function failureOf(creating: CreatingStage, error: unknown): CreateFailure {
  const detail = error instanceof Error && error.message ? error.message : null;
  if (creating.steps.includes('folder')) return { kind: 'not_started', detail };
  const reason = error instanceof ServerError ? error.data?.reason : undefined;
  return { kind: reason === 'not_found' || reason === 'invalid_config' ? reason : 'other', detail };
}

/**
 * Board NewSession: write and send, and the agent judges what it is (decision 13 in docs/alpine-cloud.md; the server asks
 * the default model, `projects/judge`). Work on this project starts a session as before. A new app shows the four
 * setups with the agent's pick chosen and why; 만들기 makes the project (`projects/create`: its folder, its web address
 * too when signed in to Alpine) and starts the AI on the idea. When unsure, or when the judging fails, it is work on this
 * project, so a new project is never made by mistake. Or go on with a conversation another app (Claude Code, Codex, …)
 * had in the project. No header and no work result panel yet: they belong to a session and appear with the first
 * message. The heading, what the screen says meanwhile and the input form one group in the middle of the screen, as
 * wide as the session's input.
 *
 * The folder is the first chip in the input bar (`ProjectChip`): the project the rail shows, changed there with
 * `onProjectChange`, or a way to add one. With `project` `null` the person chose 새로 만들기 (also when there is no
 * project at all): the heading asks what to make, the agent only picks a setup (`projects/judge` with `newProject`,
 * which never says work on a project; if it does anyway, or fails, the setups show with the usual one chosen and
 * no pick), there is no "not a new app" way out and no skills or other apps' conversations, because there is no project.
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
  onNewProject,
  onStarted,
}: {
  /** Where the session starts; `null`: making a new project. */
  project: ProjectInfo | null;
  /** The project's clone, while it is on its way or after it failed. */
  clone?: CloneInfo;
  /** The agent to start with, unless one is picked here for this project. */
  agent?: string;
  /** `null`: no project picked (back to the most recent one). */
  onProjectChange: (path: string | null) => void;
  /** 새로 만들기 in the dialog the project chip opens. */
  onNewProject: () => void;
  onStarted: (sessionId: string) => void;
}) {
  const slash = useSlashSkills(project?.path);
  const t = useMessages(messages);
  const added = useMessages(projectAddMessages);
  const cancelClone = useCancelClone();
  const [retrying, setRetrying] = useState<string | null>(null);
  const defaultModel = useConnections().data?.defaultModel;
  const newSession = useNewSession();
  const sendMessage = useSendMessage();
  // The project the screen is about: its folder, or `null` while making a new project.
  const where = project?.path ?? null;
  // A session made for a message that then failed to send is used again on retry (with the same agent), not made twice.
  const made = useRef<{ path: string; agent: string | null; id: string } | null>(null);
  // An agent picked in the chip, for this project only.
  const [picked, setPicked] = useState<{ path: string | null; id: string } | null>(null);
  const agents = useAgents().data?.agents;
  const defaultMode = useSettings().data?.mode;
  const [mode, setMode] = useState<Mode | null>(null);
  const shownMode = mode ?? defaultMode;
  const { locale } = useLocale();
  const judge = useJudgeNewProject();
  const createProject = useCreateProject();
  const templates = useTemplates();
  const signedIn = useCloudStatus().data?.signedIn ?? false;
  const queryClient = useQueryClient();
  const node = useNodeTools();
  const [gate, setGate] = useState<Gate | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  // Putting a message back in the input: after a session that would not start, or on the project that was made.
  const [prefill, setPrefill] = useState<{ text: string; key: number } | undefined>();
  const [startFailed, setStartFailed] = useState(false);
  // Which send or create is the latest: a slower answer to an earlier one is ignored, and so is any once I have left.
  const turn = useRef(0);
  useEffect(
    () => () => {
      turn.current++;
    },
    [],
  );
  // The judging whose answer is still wanted (its turn). It is about the project it was sent on (or about making a new
  // one), so moving to another project drops it, and drops the setups shown for it: they must not start a session or
  // make a project there. A project being made goes on, so `turn` is left alone.
  const judging = useRef<number | null>(null);
  const seen = useRef(where);
  useLayoutEffect(() => {
    if (seen.current === where) return;
    seen.current = where;
    judging.current = null;
    setStage((last) => (last?.name === 'creating' ? last : null));
    setStartFailed(false);
  }, [where]);

  const wanted = (picked?.path === where ? picked.id : null) ?? agent ?? project?.lastAgent ?? DEFAULT_AGENT;
  // Until the agents are read (or when they cannot be), no agent is sent, so the server applies its own choice
  // (the project's last agent, then the default) rather than the app forcing the default one.
  const known = agents?.some((a) => a.id === wanted) ?? false;
  const shown = known ? wanted : DEFAULT_AGENT;
  const sent = known ? wanted : null;
  const shownAgent = agents?.find((a) => a.id === shown);

  const start = async (text: string, at: ProjectInfo) => {
    if (made.current?.path !== at.path || made.current.agent !== sent) {
      const info = await newSession.mutateAsync({
        cwd: at.path,
        ...(sent ? { agent: sent } : {}),
        ...(mode ? { mode } : {}),
      });
      made.current = { path: at.path, agent: sent, id: info.id };
    }
    const { id } = made.current;
    await sendMessage.mutateAsync({ sessionId: id, text });
    made.current = null;
    setMode(null);
    onStarted(id);
  };

  // Work on this project: starts the session. If that fails the message is back in the input, and a line says so.
  const work = (text: string, at: ProjectInfo) => {
    setStage(null);
    start(text, at).catch(() => {
      setPrefill({ text, key: Date.now() });
      setStartFailed(true);
    });
  };

  // Sending hands the text over at once (the input empties) and the agent judges it; sending again while it judges
  // or while the setups are shown starts over with the new text.
  const send = (text: string) => {
    const mine = ++turn.current;
    judging.current = mine;
    setStartFailed(false);
    setStage({ name: 'judging', text });
    judge
      .mutateAsync(
        project ? { text: text.trim(), locale, cwd: project.path } : { text: text.trim(), locale, newProject: true },
      )
      // A question that failed is not an answer: the message goes to the project, where the session shows what is wrong.
      .catch((): Judgement => ({ kind: 'change' }))
      .then((judgement) => {
        if (mine !== turn.current || judging.current !== mine) return;
        judging.current = null;
        if (judgement.kind === 'new')
          setStage({ name: 'choosing', text, judged: judgement, template: judgement.template });
        else if (project) work(text, project);
        // Making a new project: there is no project to work on, so the setups show without anybody's pick.
        else setStage({ name: 'choosing', text, judged: null, template: FALLBACK_TEMPLATE });
      });
    return Promise.resolve();
  };

  const create = (chosen: Extract<Stage, { name: 'choosing' }>) => {
    const mine = ++turn.current;
    const update = (change: (creating: CreatingStage) => CreatingStage) =>
      setStage((last) => (mine === turn.current && last?.name === 'creating' ? change(last) : last));
    setStage({ ...chosen, name: 'creating', steps: [], project: null, address: null, outcome: { status: 'working' } });
    createProject
      .mutateAsync({
        idea: chosen.text.trim(),
        template: chosen.template,
        // Without a pick there is no name either: the server names the folder itself.
        name: chosen.judged?.name ?? '',
        ...(sent ? { agent: sent } : {}),
        ...(mode ? { mode } : {}),
        onStep: (step, made, address) =>
          update((creating) => ({
            ...creating,
            steps: [...creating.steps, step],
            project: made,
            address: address ?? creating.address,
          })),
      })
      .then(
        ({ project: made, sessionId, address }) => {
          setMode(null);
          update((creating) => ({
            ...creating,
            project: made,
            address: address ?? creating.address,
            outcome: { status: 'done', sessionId },
          }));
        },
        (error: unknown) => update((creating) => ({ ...creating, outcome: { status: 'failed', error } })),
      );
  };

  // 만들기: first what the setup needs. A realtime web app needs the Alpine account (decision 23), a web app needs
  // Node.js (6.3); each is asked for in a sheet, and 만들기 goes on by itself when it is there.
  const requestCreate = (chosen: Extract<Stage, { name: 'choosing' }>, skip?: Gate['kind']) => {
    const web = chosen.template === 'web-lite' || chosen.template === 'web-pro';
    // What is true now, not at the last render: this runs right after signing in or starting the trial.
    const now = queryClient.getQueryData<CloudStatus>(cloudKey);
    if (chosen.template === 'web-pro' && !now?.signedIn && skip !== 'sign-in')
      return setGate({ kind: 'sign-in', chosen });
    if (chosen.template === 'web-pro' && now?.limits && !now.limits.webPro && skip !== 'upgrade')
      return setGate({ kind: 'upgrade', chosen });
    if (web && node.data?.ready === false && skip !== 'node') return setGate({ kind: 'node', chosen });
    setGate(null);
    create(chosen);
  };

  // After a failure: back to the setups, or (the project exists, only the AI did not start) on to that project with
  // the message in the input.
  const back = (creating: CreatingStage, failure: CreateFailure) => {
    if (failure.kind !== 'not_started' || !creating.project) return setStage({ ...creating, name: 'choosing' });
    setStage(null);
    setPrefill({ text: creating.text, key: Date.now() });
    onProjectChange(creating.project.path);
  };

  const locked = clone?.state === 'failed' || stage?.name === 'creating';
  return (
    <main aria-label={t.newSession} className="relative flex min-h-0 min-w-120 grow flex-col overflow-hidden bg-canvas">
      {/* The snow scene is the face of the start screen; while something is being worked on it steps back. */}
      <Snowscape className={clsx('transition-opacity duration-500', (clone || stage) && 'opacity-20')} />
      <div className="relative flex min-h-0 grow flex-col overflow-y-auto">
        {/* What is said above the input sits on top of it, so the input itself is the middle of the screen. */}
        <div className="flex grow basis-0 flex-col justify-end">
          <div className="mx-auto flex w-full max-w-175 shrink-0 flex-col gap-6 px-6 pt-6 pb-6">
            {clone ? (
              <div className="flex justify-center">
                <Receiving
                  clone={clone}
                  onCancel={() => cancelClone.mutate(clone.id, { onSuccess: () => onProjectChange(null) })}
                  onDismiss={() => cancelClone.mutate(clone.id, { onSuccess: () => onProjectChange(null) })}
                  onRetry={() => setRetrying(clone.address)}
                />
              </div>
            ) : (
              <AutoHeight className="w-full">
                {stage?.name === 'judging' ? (
                  <div key="judging" className="motion-step flex flex-col items-center gap-4 text-center">
                    <Asked text={stage.text} />
                    <p role="status" className="inline-flex items-center gap-2 text-body text-fg-muted">
                      <Dots />
                      {t.judging}
                    </p>
                  </div>
                ) : stage?.name === 'choosing' ? (
                  <div key="choosing" className="motion-step flex flex-col gap-4">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <Asked text={stage.text} />
                      <h1 className="text-title font-semibold">{project ? t.newAppHeading : t.pickSetupHeading}</h1>
                    </div>
                    <TemplateCards
                      templates={templates}
                      value={stage.template}
                      onChange={(template) => setStage({ ...stage, template })}
                      recommendation={stage.judged ?? undefined}
                    />
                    <div className="flex items-center justify-between gap-3">
                      {project && <LinkButton onClick={() => work(stage.text, project)}>{t.notNew}</LinkButton>}
                      <div className="ml-auto flex items-center gap-3">
                        <span className="text-meta text-fg-muted">{signedIn ? t.liveNote : t.localNote}</span>
                        <Button variant="primary" autoFocus onClick={() => requestCreate(stage)}>
                          {t.create}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : stage?.name === 'creating' ? (
                  <CreatingFrom
                    key="creating"
                    stage={stage}
                    online={signedIn}
                    onOpen={(sessionId) => onStarted(sessionId)}
                    onBack={back}
                  />
                ) : (
                  <div key="start" className="motion-step flex flex-col items-center gap-6">
                    <h1 className="text-center text-display font-semibold">{project ? t.heading : t.newHeading}</h1>
                    {startFailed && (
                      <p role="alert" className="text-body text-danger">
                        {t.startFailed}
                      </p>
                    )}
                    {project && <ImportLink cwd={project.path} onOpen={onStarted} />}
                  </div>
                )}
              </AutoHeight>
            )}
          </div>
        </div>
        <div className="mx-auto w-full max-w-205 shrink-0 px-6">
          <Composer
            large
            placeholder={project ? t.placeholder : t.newPlaceholder}
            locked={locked}
            waiting={clone?.state === 'receiving' ? added.waitToSend : undefined}
            onSend={send}
            prefill={prefill}
            slash={project ? slash : undefined}
            mode={shownMode ? { value: shownMode, onChange: setMode } : undefined}
            project={
              <ProjectChip project={project} disabled={locked} onChange={onProjectChange} onNewProject={onNewProject} />
            }
            agent={
              <AgentChip
                context="new"
                agentId={shown}
                model={shownAgent?.model ?? defaultModel ?? null}
                lastUsed={project?.lastAgent}
                onChange={(id) => setPicked({ path: where, id })}
              />
            }
          />
        </div>
        <div className="grow basis-0" />
      </div>
      <Dialog.Root open={gate?.kind === 'sign-in'} onOpenChange={(open) => !open && setGate(null)}>
        <Dialog.Popup>
          {gate?.kind === 'sign-in' && (
            <AlpineSignIn
              reason={t.proSignInReason}
              onBack={() => setGate(null)}
              onDone={() => requestCreate(gate.chosen, 'sign-in')}
            />
          )}
        </Dialog.Popup>
      </Dialog.Root>
      <Dialog.Root open={gate?.kind === 'upgrade'} onOpenChange={(open) => !open && setGate(null)}>
        <Dialog.Popup>
          {gate?.kind === 'upgrade' && (
            <UpgradeSheet
              reason={t.proUpgradeReason}
              onBack={() => setGate(null)}
              onDone={() => requestCreate(gate.chosen, 'upgrade')}
            />
          )}
        </Dialog.Popup>
      </Dialog.Root>
      <NodeInstall
        open={gate?.kind === 'node'}
        onReady={() => gate && requestCreate(gate.chosen, 'node')}
        onClose={() => setGate(null)}
      />
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

/** The Creating screen for a stage: what the server announced, and how the request ended. */
function CreatingFrom({
  stage,
  online,
  onOpen,
  onBack,
}: {
  stage: CreatingStage;
  online: boolean;
  onOpen: (sessionId: string) => void;
  onBack: (stage: CreatingStage, failure: CreateFailure) => void;
}) {
  const { outcome } = stage;
  const failure = outcome.status === 'failed' ? failureOf(stage, outcome.error) : null;
  return (
    <Creating
      online={online}
      template={stage.template}
      steps={stage.steps}
      project={stage.project}
      address={stage.address}
      done={outcome.status === 'done'}
      failure={failure}
      onOpen={() => outcome.status === 'done' && onOpen(outcome.sessionId)}
      onBack={() => failure && onBack(stage, failure)}
    />
  );
}

/** What I sent, quoted back while the agent works on it. */
function Asked({ text }: { text: string }) {
  return (
    <p className="max-w-full self-center rounded-2xl bg-hover px-4 py-2.5 text-left text-reading break-words text-fg">
      {text}
    </p>
  );
}

/** Three dots taking turns, for "the agent is thinking". Still under reduced motion. */
function Dots() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-pulse rounded-full bg-interactive motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
