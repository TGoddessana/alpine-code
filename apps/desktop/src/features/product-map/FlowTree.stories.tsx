import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';

import { FlowTree, type PromiseTarget } from './FlowTree';
import { POSTGRES_TREE } from './flowTreeExample';
import { updatePromises, type TreeMap, type TreePromise } from './flowTreeModel';

/** A stand-in for the server: checks take a moment each and settle one by one, like an agent trying them in turn. */
function Harness({ start, initialPerson }: { start: TreeMap; initialPerson?: string }) {
  const [map, setMap] = useState(start);
  const removed = useRef<{ cardId: string; index: number; promise: TreePromise } | null>(null);
  const keyOf = (target: PromiseTarget) => `${target.cardId}/${target.promiseId}`;

  const settle = (targets: PromiseTarget[], outcome: (promise: TreePromise, at: number) => TreePromise) => {
    const wanted = new Set(targets.map(keyOf));
    setMap((current) =>
      updatePromises(current, (cardId, promise) =>
        wanted.has(keyOf({ cardId, promiseId: promise.id })) ? { ...promise, status: 'checking' } : promise,
      ),
    );
    targets.slice(0, 60).forEach((target, order) => {
      setTimeout(
        () =>
          setMap((current) =>
            updatePromises(current, (cardId, promise) =>
              cardId === target.cardId && promise.id === target.promiseId ? outcome(promise, order) : promise,
            ),
          ),
        900 + order * 260 + (hash(target.promiseId) % 5) * 120,
      );
    });
  };

  return (
    <FlowTree
      map={map}
      initialPerson={initialPerson}
      onCheck={(targets) =>
        settle(targets, (promise) => {
          const roll = hash(promise.id) % 17;
          const checkedAt = new Date().toISOString();
          if (roll === 0)
            return {
              ...promise,
              status: 'failed',
              checkedAt,
              note: '직접 해 보니 오류 메시지 대신 연결이 그냥 끊겼어요. 약속과 다르게 동작해요.',
            };
          if (roll === 1)
            return {
              ...promise,
              status: 'blocked',
              checkedAt,
              note: '이 확인에는 실제 서버 두 대가 필요해서, 이 컴퓨터에서는 해 볼 수 없었어요.',
            };
          return { ...promise, status: 'passed', checkedAt, note: 'AI가 직접 해 보니 약속대로 동작했어요.' };
        })
      }
      onFix={(targets) =>
        settle(targets, (promise) => ({
          ...promise,
          status: 'passed',
          checkedAt: new Date().toISOString(),
          note: 'AI가 고친 뒤 다시 해 보니 약속대로 동작했어요.',
        }))
      }
      onAddPromise={(cardId, when, then) =>
        setMap((current) => ({
          ...current,
          cards: {
            ...current.cards,
            [cardId]: {
              ...current.cards[cardId]!,
              promises: [
                ...current.cards[cardId]!.promises,
                { id: `new-${Date.now()}`, when, then, status: 'planned', note: '', checkedAt: null },
              ],
            },
          },
        }))
      }
      onRemovePromise={(target) =>
        setMap((current) => {
          const card = current.cards[target.cardId]!;
          const index = card.promises.findIndex((promise) => promise.id === target.promiseId);
          removed.current = { cardId: target.cardId, index, promise: card.promises[index]! };
          return {
            ...current,
            cards: {
              ...current.cards,
              [card.id]: { ...card, promises: card.promises.filter((_, at) => at !== index) },
            },
          };
        })
      }
      onUndoRemove={() => {
        const last = removed.current;
        if (!last) return;
        removed.current = null;
        setMap((current) => {
          const card = current.cards[last.cardId]!;
          const promises = [...card.promises];
          promises.splice(last.index, 0, last.promise);
          return { ...current, cards: { ...current.cards, [card.id]: { ...card, promises } } };
        });
      }}
      onAddJourney={(personId, title, goal) =>
        setMap((current) => ({
          ...current,
          people: current.people.map((person) =>
            person.id === personId
              ? {
                  ...person,
                  journeys: [
                    ...person.journeys,
                    {
                      id: `${personId}-${Date.now()}`,
                      title: { ko: title, en: title },
                      goal: { ko: goal, en: goal },
                      steps: [],
                    },
                  ],
                }
              : person,
          ),
        }))
      }
      onFindSteps={() => {}}
      onAddPerson={(name) =>
        setMap((current) => ({
          ...current,
          people: [
            ...current.people,
            {
              id: `person-${Date.now()}`,
              name: { ko: name, en: name },
              role: { ko: '', en: '' },
              start: { ko: '', en: '' },
              tone: ((current.people.length % 5) + 1) as 1 | 2 | 3 | 4 | 5,
              journeys: [],
            },
          ],
        }))
      }
    />
  );
}

function hash(text: string) {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}

/** The same map with the states a growing project shows: a broken promise, one being checked, a new one. */
const MIXED: TreeMap = updatePromises(POSTGRES_TREE, (cardId, promise) => {
  if (cardId === 'client-error' && promise.id === POSTGRES_TREE.cards['client-error']!.promises[1]!.id)
    return {
      ...promise,
      status: 'failed',
      checkedAt: '2026-10-20T09:12:00Z',
      note: '서버를 끄고 쿼리를 보내 보니 오류 코드 없이 빈 결과가 돌아왔어요. 약속과 달라요.',
    };
  if (cardId === 'client-query-run' && promise.status === 'unconfirmed') return { ...promise, status: 'checking' };
  return promise;
});

const meta = {
  title: 'Features/Product map/Flow tree',
  component: Harness,
  args: { start: POSTGRES_TREE },
  decorators: [
    (Story) => (
      <div className="flex h-200 w-full">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

/** postgres-ultracode's real map: 103 cards, 535 promises, the checks it really ran. */
export const PostgreSQL: Story = {};
/** A promise broke, another step is being checked: what to do first comes to the top. */
export const SomethingBroke: Story = { args: { start: MIXED } };
export const Operator: Story = { args: { initialPerson: 'ops' } };
export const English: Story = { globals: { locale: 'en' } };
/** A person just added: no journeys yet. */
export const NewPerson: Story = {
  args: {
    start: {
      ...POSTGRES_TREE,
      people: [
        {
          id: 'guest',
          name: { ko: '처음 온 손님', en: 'First-time guest' },
          role: { ko: '아직 정리하지 않았어요', en: 'Not written yet' },
          start: { ko: '첫 화면을 열어요', en: 'Opens the first screen' },
          tone: 3,
          journeys: [
            { id: 'guest-first', title: { ko: '둘러보기', en: 'Look around' }, goal: { ko: '', en: '' }, steps: [] },
          ],
        },
        ...POSTGRES_TREE.people,
      ],
    },
  },
};
