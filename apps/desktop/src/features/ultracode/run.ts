/**
 * What the progress views show of one ultracode run. Prototype: the server has no runs yet, so `snapshotAt` plays a
 * scripted PostgreSQL map run (조사 1 → 작성 6 → 검토 6 → 조립 1, at most 6 at once) one step at a time.
 */

export type AgentState = 'queued' | 'working' | 'asking' | 'done' | 'stopped';

export interface RunPhase {
  title: string;
  model: string;
}

export interface RunAgent {
  id: string;
  phase: number;
  /** What this agent is doing in the user's words: the topic, not the agent's name. */
  task: string;
  agent: string;
  look: string;
  color: number;
  state: AgentState;
  /** What it is doing right now, while working. */
  activity: string | null;
  turn: number;
  /** The agent whose result it took over, for the hand-over walk. */
  from: string | null;
  /** True for the step right after it finished: it is carrying its result to whoever takes it. */
  handing: boolean;
}

export interface RunSnapshot {
  step: number;
  minutes: number;
  phases: RunPhase[];
  agents: RunAgent[];
  /** The script's latest `log()` line. */
  log: string | null;
  planned: number;
  finished: boolean;
}

interface Plan {
  id: string;
  phase: number;
  task: string;
  agent: string;
  look: string;
  color: number;
  start: number;
  end: number;
  asking?: [number, number];
  from?: string;
  activities: string[];
}

const TOPICS = ['저장소', '복제', '백업과 복구', '쿼리 실행', '접속과 인증', '확장 기능'];

const PHASES: RunPhase[] = [
  { title: '조사', model: 'haiku' },
  { title: '작성', model: 'haiku' },
  { title: '검토', model: 'opus' },
  { title: '조립', model: 'haiku' },
];

const WRITE = ['코드 읽는 중', '약속 찾는 중', '카드 쓰는 중'];
const REVIEW = ['카드 읽는 중', '테스트 돌리는 중', '조건 확인하는 중'];

const PLANS: Plan[] = [
  {
    id: 'survey',
    phase: 0,
    task: '주제 나누기',
    agent: '기본 에이전트',
    look: 'antenna',
    color: 2,
    start: 0,
    end: 5,
    activities: ['파일 목록 보는 중', 'README 읽는 중', '주제 나누는 중'],
  },
  ...TOPICS.map<Plan>((task, i) => ({
    id: `write-${i}`,
    phase: 1,
    task,
    agent: '기본 에이전트',
    look: 'antenna',
    color: 2,
    start: 6,
    end: 14 + i,
    ...(i === 2 ? { asking: [9, 12] as [number, number] } : {}),
    activities: WRITE,
  })),
  ...TOPICS.map<Plan>((task, i) => ({
    id: `review-${i}`,
    phase: 2,
    task,
    agent: '꼼꼼한 검토자',
    look: 'glasses',
    color: 4,
    start: 15 + i,
    end: 21 + i,
    ...(i === 1 ? { asking: [18, 20] as [number, number] } : {}),
    from: `write-${i}`,
    activities: REVIEW,
  })),
  {
    id: 'assemble',
    phase: 3,
    task: '카드 모아 지도 만들기',
    agent: '기본 에이전트',
    look: 'antenna',
    color: 2,
    start: 27,
    end: 31,
    activities: ['카드 모으는 중', '흐름 잇는 중'],
  },
];

export const LAST_STEP = 32;

/** About 40 seconds of the real run per step, so the whole run is about 20 minutes. */
const SECONDS_PER_STEP = 40;

export function snapshotAt(step: number): RunSnapshot {
  const agents = PLANS.map((plan) => agentAt(plan, step));
  return {
    step,
    minutes: Math.floor((step * SECONDS_PER_STEP) / 60),
    phases: PHASES,
    agents,
    log: logAt(step),
    planned: PLANS.length,
    finished: step >= LAST_STEP,
  };
}

function agentAt(plan: Plan, step: number): RunAgent {
  const asking = plan.asking !== undefined && step >= plan.asking[0] && step < plan.asking[1];
  const state: AgentState = step < plan.start ? 'queued' : step >= plan.end ? 'done' : asking ? 'asking' : 'working';
  const progress = (step - plan.start) / (plan.end - plan.start);
  const activity =
    state === 'working'
      ? plan.activities[Math.min(plan.activities.length - 1, Math.floor(progress * plan.activities.length))]!
      : null;
  return {
    id: plan.id,
    phase: plan.phase,
    task: plan.task,
    agent: plan.agent,
    look: plan.look,
    color: plan.color,
    state,
    activity,
    turn: state === 'queued' ? 0 : Math.max(1, Math.min(step, plan.end) - plan.start) * 3,
    from: plan.from ?? null,
    handing: step === plan.end && plan.phase < PHASES.length - 1,
  };
}

function logAt(step: number): string | null {
  if (step < 5) return null;
  if (step < 15) return `주제 ${TOPICS.length}개로 나눴어요: ${TOPICS.slice(0, 3).join(', ')} …`;
  if (step < 27) {
    const reviewed = TOPICS.filter((_, i) => step >= 21 + i);
    return reviewed.length
      ? `${reviewed.at(-1)} 검토: 조건이 빠진 약속 ${reviewed.length + 1}개를 고쳤어요`
      : '작성한 카드를 검토자에게 넘기는 중이에요';
  }
  if (step < LAST_STEP) return '카드 103장을 흐름 29개로 잇는 중이에요';
  return '카드 103장, 흐름 29개, 약속 535개를 그렸어요';
}

/** A run where the survey found more topics than planned: the script wants 23 agents, the card said 14. */
export function overPlanned(): RunSnapshot {
  const run = snapshotAt(16);
  return { ...run, log: '주제가 6개 → 20개로 늘었어요' };
}

export function counts(run: RunSnapshot) {
  const done = run.agents.filter((a) => a.state === 'done').length;
  const asking = run.agents.filter((a) => a.state === 'asking').length;
  const working = run.agents.filter((a) => a.state === 'working').length;
  return { done, asking, working, total: run.agents.length };
}
