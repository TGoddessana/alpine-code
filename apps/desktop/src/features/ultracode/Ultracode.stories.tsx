import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { AgentsTab } from './AgentsTab';
import { ProgressCard, ProposalCard } from './Cards';
import { LAST_STEP, overPlanned, snapshotAt } from './run';
import { Workshop } from './Workshop';

/**
 * Prototype of ultracode's screens (decisions 4-6 in alpine-code-archive/docs/ultracode.md), played from a scripted
 * PostgreSQL map run: 조사 1 → 작성 6 → 검토 6 → 조립 1, at most 6 at once. No server yet.
 */
const meta = {
  title: 'Ultracode/Prototype',
  parameters: { server: {}, layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** One step about every second, from `from` to the end and around again; the slider scrubs. */
function usePlayback(from = 0) {
  const [step, setStep] = useState(from);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setStep((s) => (s >= LAST_STEP + 2 ? from : s + 1)), 1100);
    return () => clearInterval(timer);
  }, [playing, from]);
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
  return { run: snapshotAt(Math.min(step, LAST_STEP)), controls };
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

/** The whole session: the chat with its card, the dock open on 에이전트. Clicking a hare opens its record. */
export const InSession: Story = {
  render: function Render() {
    const { run, controls } = usePlayback();
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <div className="flex h-screen flex-col bg-canvas text-fg">
        <div className="border-b border-line px-4 py-2">{controls}</div>
        <div className="flex min-h-0 grow">
          <Chat>
            <ProgressCard run={run} title="지도 그리기" onSelect={setSelected} />
          </Chat>
          <aside className="flex w-[480px] shrink-0 flex-col overflow-auto border-l border-line bg-canvas-raised">
            <div className="flex gap-4 border-b border-line px-4 py-2 text-body">
              <span className="text-fg-muted">작업 결과</span>
              <span className="text-fg-muted">터미널</span>
              <span className="font-medium">에이전트</span>
            </div>
            <AgentsTab run={run} selected={selected} onSelect={setSelected} />
          </aside>
        </div>
      </div>
    );
  },
};

/** Decision 4 and 5: before anything runs. */
export const Proposal: Story = {
  render: () => (
    <div className="flex h-screen bg-canvas text-fg">
      <Chat>
        <ProposalCard run={snapshotAt(-1)} minutes={20} />
      </Chat>
    </div>
  ),
};

/** Decision 5: the survey found 20 topics, the script wants 23 agents, the card said 14. */
export const OverPlan: Story = {
  render: () => (
    <div className="flex h-screen bg-canvas text-fg">
      <Chat>
        <ProgressCard run={overPlanned()} title="지도 그리기" over={{ needed: 23 }} />
      </Chat>
    </div>
  ),
};

/** The room alone, large, with names: what "agents working together" looks like. */
export const Room: Story = {
  render: function Render() {
    const { run, controls } = usePlayback();
    return (
      <div className="flex min-h-screen flex-col gap-6 bg-canvas p-8 text-fg">
        {controls}
        <div className="max-w-240">
          <Workshop run={run} size={56} />
        </div>
        {run.log && <p className="text-body text-fg-muted">{run.log}</p>}
      </div>
    );
  },
};

/** The same moments side by side: before, while writing, one waiting for approval, reviewing, done. */
export const Moments: Story = {
  render: () => (
    <div className="flex min-h-screen flex-col gap-6 bg-canvas p-8 text-fg">
      {[3, 10, 18, 24, LAST_STEP].map((step) => (
        <div key={step} className="flex max-w-160 flex-col gap-1">
          <span className="text-meta text-fg-faint">단계 {step}</span>
          <ProgressCard run={snapshotAt(step)} title="지도 그리기" />
        </div>
      ))}
    </div>
  ),
};
