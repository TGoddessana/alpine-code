import type { FlowGetResult, FlowNode } from '@alpine/protocol';
import { useCallback, useRef, type ReactNode } from 'react';

import { useMessages } from '@/shared/i18n';
import { useEditFlow, useServer, useSetActor, useSetFlow } from '@/shared/server';

import { FlowTree, type StepParts } from './FlowTree';
import { flowTreeMessages } from './flowTreeMessages';
import type { TreeMap } from './flowTreeModel';

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
  map,
  board,
  seenAt,
  start,
  onSession,
  drawing = false,
  lit = null,
  reveal = null,
  stepParts,
  promiseExtras,
}: {
  cwd: string;
  /** `board` read person first (`toTreeMap`). */
  map: TreeMap;
  board: FlowGetResult;
  seenAt?: string | null;
  start: JourneyStart;
  onSession: (id: string) => void;
  /** The AI is drawing the map: keep it all in view as cards land. */
  drawing?: boolean;
  /** Cards the page lights (search, a status); the rest quiets down. */
  lit?: Set<string> | null;
  /** A card the page asks to show. */
  reveal?: { cardId: string; seq: number } | null;
  stepParts?: (cardId: string) => StepParts;
  promiseExtras?: (cardId: string, promiseId: string) => ReactNode;
}) {
  const t = useMessages(flowTreeMessages);
  const edit = useEditFlow();
  const decide = useSetFlow();
  const setActor = useSetActor();
  const server = useServer();
  const readSource = useCallback(
    (path: string) => server.request('files/read', { cwd, path, startLine: 1, limit: 400 }),
    [server, cwd],
  );
  const removed = useRef<{ cardId: string; text: string } | null>(null);
  const readOnly = !!board.readOnly;
  const nodeOf = (id: string) => board.document?.nodes?.find((node) => node.id === id) ?? null;

  return (
    <FlowTree
      map={map}
      drawing={drawing}
      lit={lit}
      reveal={reveal}
      stepParts={stepParts}
      promiseExtras={promiseExtras}
      seenAt={seenAt ?? undefined}
      readSource={readSource}
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
        !readOnly &&
        edit.mutate({
          cwd,
          nodeId: cardId,
          field: 'promise',
          conditionId: null,
          // Either part may be left empty; only both together read "when, then".
          value: when.trim() && then.trim() ? `${when.trim()}, ${then.trim()}` : when.trim() || then.trim(),
        })
      }
      onRemovePromise={({ cardId, promiseId }) => {
        if (readOnly) return;
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
      // A map from a newer Alpine is read only: no decisions to write (the decision chips are not shown).
      onDecide={readOnly ? undefined : (cardId, field, value) => decide.mutate({ cwd, nodeId: cardId, field, value })}
      onOpenSession={onSession}
      onSetActor={(flowIds, actor) =>
        flowIds.length && setActor.mutate({ cwd, flowIds: flowIds as [string, ...string[]], actor })
      }
    />
  );
}
