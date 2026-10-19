import type { TaskForceItem } from '@alpine/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import type { Item, Script } from '@/shared/server';

import { RecordItems } from '@/features/session/RecordItems';
import { AgentsTab } from '@/features/taskforce/AgentsTab';
import { roomOf, TaskForceCard, Workshop } from '@/shared/components/taskforce';
import { interrupted, LAST_STEP, overPlanned, taskForceAt } from '@/shared/components/taskforce/fixtures';

/** The server answers the cards' buttons, and an agent's record is a few calls and its answer. */
const server: Script = {
  results: {
    'taskforce/start': {},
    'taskforce/decline': {},
    'taskforce/stop': {},
    'taskforce/allowMore': {},
    'taskforce/takeResults': {},
    'taskforce/resume': {},
    'taskforce/stopAgent': { stopped: true },
    'taskforce/record': ({ memberId }) => ({
      items: [
        call(`${memberId}-1`, 'read', { path: 'src/backend/replication/walsender.c' }),
        call(`${memberId}-2`, 'bash', { command: 'make check TESTS=recovery' }),
        call(`${memberId}-3`, 'write', { path: `features/${memberId}.json`, content: '{}' }),
        {
          id: `${memberId}-answer`,
          kind: 'agent_message',
          text: '복제 카드 9장을 썼어요. `wal_level=replica` 이상일 때만 성립하는 약속은 조건을 달았어요.',
          agent: null,
        },
      ],
    }),
  },
};

function call(id: string, name: string, args: Record<string, unknown>) {
  return {
    id,
    kind: 'tool_call' as const,
    name,
    args,
    status: 'done' as const,
    result: 'ok',
    images: 0,
    commandResult: null,
    fileChanges: null,
  };
}

/**
 * TF's screens (decisions 4-6 in alpine-code-archive/docs/taskforce.md), drawn from protocol items of a scripted
 * PostgreSQL map run: 조사 1 → 작성 6 → 검토 6 → 조립 1, at most 6 at once.
 */
const meta = {
  title: 'TaskForce/Screens',
  parameters: { server, layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** One step about every second, around again at the end; the slider scrubs. */
function usePlayback() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setStep((s) => (s >= LAST_STEP + 2 ? 0 : s + 1)), 1100);
    return () => clearInterval(timer);
  }, [playing]);
  const controls = (
    <div className="flex items-center gap-3 text-meta text-fg-muted">
      <button
        type="button"
        className="cursor-pointer rounded-md border border-line px-2 py-0.5"
        onClick={() => setPlaying(!playing)}
      >
        {playing ? '일시정지' : '재생'}
      </button>
      <input
        type="range"
        min={0}
        max={LAST_STEP}
        value={Math.min(step, LAST_STEP)}
        onChange={(e) => {
          setPlaying(false);
          setStep(Number(e.target.value));
        }}
        className="w-64"
      />
      <span className="tabular-nums">단계 {Math.min(step, LAST_STEP)}</span>
    </div>
  );
  return { item: taskForceAt(Math.min(step, LAST_STEP)), controls };
}

function Chat({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 grow flex-col gap-4 overflow-auto p-6">
      <div className="mx-auto flex w-full max-w-160 flex-col gap-4">
        <div className="self-end rounded-xl bg-canvas-sunken px-3 py-2 text-reading">이 저장소 지도 그려 줘</div>
        <p className="text-reading">
          코드가 커서 혼자 그리면 중요한 부분만 그리게 돼요. 주제별로 나눠서 그리고, 강한 모델이 검토하게 할게요.
        </p>
        {children}
      </div>
    </div>
  );
}

function Card({ item }: { item: TaskForceItem }) {
  return <TaskForceCard sessionId="story" item={item} />;
}

/** The whole session: the chat with its card, the dock open on TF. Clicking a hare opens its record. */
export const InSession: Story = {
  render: function Render() {
    const { item, controls } = usePlayback();
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <div className="flex h-screen flex-col bg-canvas text-fg">
        <div className="border-b border-line px-4 py-2">{controls}</div>
        <div className="flex min-h-0 grow">
          <Chat>
            <TaskForceCard sessionId="story" item={item} onShowAgents={() => setSelected(null)} />
          </Chat>
          <aside className="flex w-[480px] shrink-0 flex-col overflow-auto border-l border-line bg-canvas-raised">
            <div className="flex gap-4 border-b border-line px-4 py-2 text-body">
              <span className="text-fg-muted">작업 결과</span>
              <span className="text-fg-muted">터미널</span>
              <span className="font-medium">TF</span>
            </div>
            <AgentsTab
              sessionId="story"
              item={item}
              selected={selected}
              onSelect={setSelected}
              renderRecord={(items: Item[]) => <RecordItems items={items} />}
            />
          </aside>
        </div>
      </div>
    );
  },
};

/** Decisions 4 and 5: before anything runs. */
export const Proposal: Story = {
  render: () => (
    <div className="flex h-screen bg-canvas text-fg">
      <Chat>
        <Card item={taskForceAt(-1)} />
      </Chat>
    </div>
  ),
};

/** Decision 5: the survey found 20 topics, the script wants 23 agents, the card said 14. */
export const OverPlan: Story = {
  render: () => (
    <div className="flex h-screen bg-canvas text-fg">
      <Chat>
        <Card item={overPlanned()} />
      </Chat>
    </div>
  ),
};

/** Decision 8: the app closed during the reviews. */
export const Interrupted: Story = {
  render: () => (
    <div className="flex h-screen bg-canvas text-fg">
      <Chat>
        <Card item={interrupted()} />
      </Chat>
    </div>
  ),
};

/** The room alone, large, with names: what "agents working together" looks like. */
export const Room: Story = {
  render: function Render() {
    const { item, controls } = usePlayback();
    return (
      <div className="flex min-h-screen flex-col gap-6 bg-canvas p-8 text-fg">
        {controls}
        <div className="max-w-240">
          <Workshop room={roomOf(item)} size={56} />
        </div>
        {item.log && <p className="text-body text-fg-muted">{item.log}</p>}
      </div>
    );
  },
};

/** The same card at several moments: before, while writing, one waiting for approval, reviewing, done. */
export const Moments: Story = {
  render: () => (
    <div className="flex min-h-screen flex-col gap-6 bg-canvas p-8 text-fg">
      {[3, 10, 18, 24, LAST_STEP].map((step) => (
        <div key={step} className="flex max-w-160 flex-col gap-1">
          <span className="text-meta text-fg-faint">단계 {step}</span>
          <Card item={taskForceAt(step)} />
        </div>
      ))}
    </div>
  ),
};
