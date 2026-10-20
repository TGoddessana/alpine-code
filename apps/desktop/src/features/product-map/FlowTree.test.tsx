import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';

import { FlowTree, type FlowTreeProps } from './FlowTree';
import { journeyTally, personTally, tally, worst, type TreeMap } from './flowTreeModel';

const promise = (id: string, status: TreeMap['cards'][string]['promises'][number]['status'], when = '') => ({
  id,
  when: when || `${id}일 때`,
  then: `${id}가 돼요`,
  status,
  note: status === 'failed' ? '약속과 달라요' : '',
  checkedAt: null,
});

const MAP: TreeMap = {
  product: '공방 예약',
  people: [
    {
      id: 'guest',
      name: { ko: '손님', en: 'Guest' },
      role: { ko: '수업을 예약해요', en: 'Books classes' },
      start: { ko: '첫 화면에서 수업을 골라요', en: 'Picks a class' },
      tone: 1,
      journeys: [
        {
          id: 'book',
          title: { ko: '수업 예약하기', en: 'Book a class' },
          goal: { ko: '고르고 결제해요', en: 'Pick and pay' },
          steps: ['pick', 'pay'],
        },
      ],
    },
    {
      id: 'owner',
      name: { ko: '사장님', en: 'Owner' },
      role: { ko: '수업을 열어요', en: 'Runs classes' },
      start: { ko: '관리 화면을 열어요', en: 'Opens admin' },
      tone: 2,
      journeys: [
        {
          id: 'open',
          title: { ko: '수업 열기', en: 'Open a class' },
          goal: { ko: '', en: '' },
          steps: ['pay'],
        },
      ],
    },
  ],
  cards: {
    pick: { id: 'pick', title: '수업 고르기', promises: [promise('a', 'passed'), promise('b', 'unconfirmed')] },
    pay: {
      id: 'pay',
      title: '결제하기',
      promises: [promise('c', 'failed', '카드가 거절되면'), promise('d', 'passed')],
    },
  },
  recent: [],
};

function mount(overrides: Partial<FlowTreeProps> = {}) {
  const props: FlowTreeProps = {
    map: MAP,
    onCheck: vi.fn(),
    onFix: vi.fn(),
    onAddPromise: vi.fn(),
    onRemovePromise: vi.fn(),
    onUndoRemove: vi.fn(),
    onAddJourney: vi.fn(),
    onFindSteps: vi.fn(),
    onAddPerson: vi.fn(),
    ...overrides,
  };
  render(
    <LocaleProvider locale="ko">
      <FlowTree {...props} />
    </LocaleProvider>,
  );
  return props;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('flow tree model', () => {
  it('counts every status from the promises, worst first', () => {
    const counts = tally(MAP.cards.pay!.promises);
    expect(counts).toMatchObject({ failed: 1, passed: 1, total: 2 });
    expect(worst(counts)).toBe('failed');
    expect(worst(tally([]))).toBeNull();
  });

  it('a step shared by two journeys counts in each, and once for a person', () => {
    expect(journeyTally(MAP, MAP.people[0]!.journeys[0]!).total).toBe(4);
    expect(personTally(MAP, MAP.people[1]!).total).toBe(2);
  });
});

describe('FlowTree', () => {
  it('starts with the first person: the entry, the summary, and the broken promise first', () => {
    mount();
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByRole('heading', { name: '손님' })).toBeTruthy();
    expect(within(panel).getByText('첫 화면에서 수업을 골라요')).toBeTruthy();
    expect(within(panel).getByText('약속 4개 중 2개 통과')).toBeTruthy();
    expect(within(panel).getByText('지키지 못한 약속이 1개 있어요')).toBeTruthy();
  });

  it("draws a band per person: their way in, their journeys, and each journey's steps in a row", () => {
    mount();
    expect(screen.getByRole('button', { name: /첫 화면에서 수업을 골라요/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /사장님/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /수업 예약하기/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /수업 고르기/ })).toBeTruthy();
    // A step shared by two journeys has a node in each row, and says it is broken.
    const pay = screen.getAllByRole('button', { name: /결제하기/ });
    expect(pay).toHaveLength(2);
    expect(within(pay[0]!).getByText('실패')).toBeTruthy();
  });

  it('a step card lists its promises as a checklist, the broken one first, and opens to list them all', () => {
    mount();
    const pay = screen.getAllByRole('button', { name: /결제하기/ })[0]!;
    const rows = within(pay).getAllByRole('listitem');
    expect(rows[0]!.textContent).toContain('카드가 거절되면');
    expect(pay.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(pay);
    expect(screen.getAllByRole('button', { name: /결제하기/ })[0]!.getAttribute('aria-expanded')).toBe('true');
  });

  it('asks to fix the broken promises and to check the unchecked ones', () => {
    const props = mount();
    fireEvent.click(screen.getByRole('button', { name: 'AI에게 고쳐 달라고 하기' }));
    expect(props.onFix).toHaveBeenCalledWith([{ cardId: 'pay', promiseId: 'c' }]);
    fireEvent.click(screen.getByRole('button', { name: 'AI에게 확인 맡기기' }));
    expect(props.onCheck).toHaveBeenCalledWith([{ cardId: 'pick', promiseId: 'b' }]);
  });

  it('"보기" opens the step of the broken promise and explains it in the panel', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    const panel = screen.getByRole('complementary');
    expect(await within(panel).findByText('카드가 거절되면')).toBeTruthy();
    expect(within(panel).getByText('약속과 달라요')).toBeTruthy();
  });

  it('picking a journey card explains it, and a shared step says where else it appears', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /수업 열기/ }));
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByRole('heading', { name: '수업 열기' })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: /결제하기/ }));
    expect(await within(panel).findByText('다른 여정에도 나와요')).toBeTruthy();
    expect(within(panel).getByText('수업 예약하기')).toBeTruthy();
  });

  it("adds a promise from a step's panel with the two fields", async () => {
    const props = mount();
    fireEvent.click(screen.getByRole('button', { name: /수업 고르기/ }));
    const panel = screen.getByRole('complementary');
    fireEvent.click(await within(panel).findByRole('button', { name: '약속 추가' }));
    fireEvent.change(within(panel).getByLabelText(/이럴 때/), { target: { value: '자리가 없으면' } });
    fireEvent.change(within(panel).getByLabelText(/이렇게 돼야 해요/), { target: { value: '대기 신청을 받아요' } });
    fireEvent.click(within(panel).getByRole('button', { name: '추가' }));
    expect(props.onAddPromise).toHaveBeenCalledWith('pick', '자리가 없으면', '대기 신청을 받아요');
  });
  it('puts code that changed under a passed promise near the top, and says which files', async () => {
    const map: TreeMap = {
      ...MAP,
      cards: {
        ...MAP.cards,
        pick: {
          ...MAP.cards.pick!,
          promises: [
            {
              ...MAP.cards.pick!.promises[0]!,
              status: 'recheck',
              changedFiles: ['src/pick.tsx'],
              note: '고를 수 있었어요',
            },
            MAP.cards.pick!.promises[1]!,
          ],
        },
      },
    };
    const props = mount({ map });
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByText('코드가 바뀌어 다시 확인할 약속이 1개 있어요')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: '다시 확인 맡기기' }));
    expect(props.onCheck).toHaveBeenCalledWith([{ cardId: 'pick', promiseId: 'a' }]);
    fireEvent.click(within(panel).getAllByRole('button', { name: '보기' })[1]!);
    expect(await within(panel).findByText('src/pick.tsx')).toBeTruthy();
  });
});
