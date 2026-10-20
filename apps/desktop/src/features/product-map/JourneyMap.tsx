import type { FlowGetResult, FlowNode, SessionInfo } from '@alpine/protocol';
import { useMemo, useRef } from 'react';

import { useMessages } from '@/shared/i18n';
import { useEditFlow, useSetActor, useSetFlow } from '@/shared/server';

import { FlowTree } from './FlowTree';
import { toTreeMap } from './flowTreeData';
import { flowTreeMessages } from './flowTreeMessages';

export type JourneyStart = (
  action: 'verify' | 'change' | 'extend' | 'reshape',
  target: { node?: FlowNode | null; flowId?: string | null; nodeIds?: string[]; request?: string },
) => Promise<boolean>;

/**
 * The person-first tree on the project's real map. Reading comes from `flow/get`; what the person asks for goes the
 * way the map already sends it: checks, fixes and new journeys start an AI session (`flow/prepare`), promises are
 * added or removed with `flow/edit`, and the person's own calls on a card are written with `flow/set`.
 */
export function JourneyMap({
  cwd,
  board,
  sessions,
  seenAt,
  start,
  onSession,
}: {
  cwd: string;
  board: FlowGetResult;
  sessions: SessionInfo[];
  seenAt?: string | null;
  start: JourneyStart;
  onSession: (id: string) => void;
}) {
  const t = useMessages(flowTreeMessages);
  const edit = useEditFlow();
  const decide = useSetFlow();
  const setActor = useSetActor();
  const removed = useRef<{ cardId: string; text: string } | null>(null);
  const project = cwd.split('/').pop() ?? cwd;
  const map = useMemo(
    () =>
      toTreeMap(board, sessions, project, {
        unnamed: { ko: t.unnamed, en: t.unnamed },
        unnamedRole: { ko: t.unnamedRole, en: t.unnamedRole },
      }),
    [board, sessions, project, t.unnamed, t.unnamedRole],
  );
  const nodeOf = (id: string) => board.document?.nodes?.find((node) => node.id === id) ?? null;

  return (
    <FlowTree
      map={map}
      seenAt={seenAt ?? undefined}
      onCheck={(targets) => void start('verify', { nodeIds: [...new Set(targets.map((target) => target.cardId))] })}
      onFix={(targets) => {
        const cardId = targets[0]?.cardId;
        const card = cardId ? map.cards[cardId] : undefined;
        if (!card) return;
        const broken = targets
          .filter((target) => target.cardId === cardId)
          .map((target) => card.promises.find((promise) => promise.id === target.promiseId)?.then)
          .filter(Boolean)
          .join(' / ');
        void start('change', { node: nodeOf(card.id), request: t.fixRequest(card.title, broken) });
      }}
      onAddPromise={(cardId, when, then) =>
        edit.mutate({
          cwd,
          nodeId: cardId,
          field: 'promise',
          conditionId: null,
          value: when ? `${when}, ${then}` : then,
        })
      }
      onRemovePromise={({ cardId, promiseId }) => {
        const text = map.cards[cardId]?.promises.find((promise) => promise.id === promiseId)?.then ?? '';
        removed.current = { cardId, text };
        edit.mutate({ cwd, nodeId: cardId, field: 'promise', conditionId: promiseId, value: '' });
      }}
      onUndoRemove={() => {
        const last = removed.current;
        removed.current = null;
        if (last?.text)
          edit.mutate({ cwd, nodeId: last.cardId, field: 'promise', conditionId: null, value: last.text });
      }}
      onAddJourney={(_, title, goal) => void start('extend', { request: t.addJourneyRequest(title, goal) })}
      onFindSteps={(journeyId) => {
        const journey = map.people.flatMap((person) => person.journeys).find((item) => item.id === journeyId);
        void start('extend', { flowId: journeyId, request: t.findStepsRequest(journey?.title.ko ?? journeyId) });
      }}
      onAddPerson={(name) => void start('reshape', { request: t.addPersonRequest(name) })}
      onDecide={(cardId, field, value) => decide.mutate({ cwd, nodeId: cardId, field, value })}
      onOpenSession={onSession}
      onSetActor={(flowIds, actor) =>
        flowIds.length && setActor.mutate({ cwd, flowIds: flowIds as [string, ...string[]], actor })
      }
    />
  );
}
