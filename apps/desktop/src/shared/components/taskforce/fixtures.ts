import type { TaskForceItem, TaskForceMember } from '@alpine/protocol';

/**
 * A TF item at any moment of a scripted PostgreSQL map run (조사 1 → 작성 6 → 검토 6 → 조립 1, at most 6 at once), for
 * stories and tests: `taskForceAt(step)` from 0 to `LAST_STEP`.
 */

interface Plan {
  id: string;
  step: string;
  task: string;
  agent: string;
  look: TaskForceMember['look'];
  color: number;
  model: string;
  start: number;
  end: number;
  asking?: [number, number];
  source?: string;
  activities: NonNullable<TaskForceMember['activity']>[];
}

const TOPICS = ['저장소', '복제', '백업과 복구', '쿼리 실행', '접속과 인증', '확장 기능'];
const HAIKU = 'anthropic/claude-haiku-5-5';
const OPUS = 'anthropic/claude-opus-5-5';

const PLANS: Plan[] = [
  {
    id: 'a1',
    step: '조사',
    task: '주제 나누기',
    agent: '',
    look: 'antenna',
    color: 2,
    model: HAIKU,
    start: 0,
    end: 5,
    activities: ['search', 'read', 'writing'],
  },
  ...TOPICS.map<Plan>((task, i) => ({
    id: `a${i + 2}`,
    step: '작성',
    task,
    agent: '',
    look: 'antenna',
    color: 2,
    model: HAIKU,
    start: 6,
    end: 14 + i,
    ...(i === 2 ? { asking: [9, 12] as [number, number] } : {}),
    activities: ['read', 'search', 'edit'],
  })),
  ...TOPICS.map<Plan>((task, i) => ({
    id: `a${i + 8}`,
    step: '검토',
    task,
    agent: '꼼꼼한 검토자',
    look: 'glasses',
    color: 4,
    model: OPUS,
    start: 15 + i,
    end: 21 + i,
    ...(i === 1 ? { asking: [18, 20] as [number, number] } : {}),
    source: `a${i + 2}`,
    activities: ['read', 'run', 'edit'],
  })),
  {
    id: 'a14',
    step: '조립',
    task: '카드 모아 지도 만들기',
    agent: '',
    look: 'antenna',
    color: 2,
    model: HAIKU,
    start: 27,
    end: 31,
    activities: ['read', 'edit'],
  },
];

export const LAST_STEP = 32;

/** About 40 seconds of the real run per step, so the whole run is about 20 minutes. */
const SECONDS_PER_STEP = 40;

export function taskForceAt(step: number, now = Date.now()): TaskForceItem {
  const started = step >= 0;
  return {
    id: 'tf-postgres',
    kind: 'taskforce',
    title: '지도 그리기',
    steps: [
      { title: '조사', count: 1, model: HAIKU },
      { title: '작성', count: 6, model: HAIKU },
      { title: '검토', count: 6, model: OPUS },
      { title: '조립', count: 1, model: HAIKU },
    ],
    minutes: 20,
    status: !started ? 'proposed' : step >= LAST_STEP ? 'done' : 'running',
    // An agent exists once the script asks for it: the writers after the survey, each reviewer when its draft is in.
    members: started ? PLANS.filter((plan) => step >= appears(plan)).map((plan) => memberAt(plan, step)) : [],
    step: !started ? '' : (PLANS.findLast((plan) => plan.start <= step)?.step ?? ''),
    log: started ? logAt(step) : null,
    needed: null,
    error: null,
    startedAt: started ? new Date(now - step * SECONDS_PER_STEP * 1000).toISOString() : null,
  };
}

function appears(plan: Plan): number {
  return plan.step === '조사' ? 0 : plan.step === '작성' ? 5 : plan.start - 1;
}

function memberAt(plan: Plan, step: number): TaskForceMember {
  const asking = plan.asking !== undefined && step >= plan.asking[0] && step < plan.asking[1];
  const state = step < plan.start ? 'queued' : step >= plan.end ? 'done' : asking ? 'asking' : 'working';
  const progress = (step - plan.start) / (plan.end - plan.start);
  return {
    id: plan.id,
    step: plan.step,
    task: plan.task,
    agent: plan.agent,
    look: plan.look,
    color: plan.color,
    model: plan.model,
    state,
    activity:
      state === 'working'
        ? plan.activities[Math.min(plan.activities.length - 1, Math.floor(progress * plan.activities.length))]!
        : null,
    turn: state === 'queued' ? 0 : Math.max(1, Math.min(step, plan.end) - plan.start) * 3,
    source: plan.source ?? null,
    cached: false,
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

/** The survey found 20 topics: the script wants 23 agents, the card said 14. */
export function overPlanned(): TaskForceItem {
  return { ...taskForceAt(16), status: 'over', needed: 23, log: '주제가 6개 → 20개로 늘었어요' };
}

/** The app closed during the reviews. */
export function interrupted(): TaskForceItem {
  const item = taskForceAt(18);
  return {
    ...item,
    status: 'interrupted',
    members: item.members.map((m) => (m.state === 'done' ? m : { ...m, state: 'stopped', activity: null })),
  };
}
