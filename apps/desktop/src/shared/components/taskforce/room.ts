import type { TaskForceItem, TaskForceMember } from '@alpine/protocol';

/** One area of the room: a step of the plan, or one the script added. */
export interface RoomStep {
  title: string;
  model: string;
}

/** A hare: a member, the area it stands in, and whether it is walking its result over right now. */
export interface RoomAgent extends TaskForceMember {
  phase: number;
  handing: boolean;
}

export interface Room {
  steps: RoomStep[];
  agents: RoomAgent[];
  planned: number;
}

/**
 * The room a TF is drawn as. Steps come from the plan the card showed, then any step the script named that the plan
 * did not. Until a step has all its planned agents, the rest stand as hares waiting (with no task, not clickable).
 */
export function roomOf(item: TaskForceItem): Room {
  const steps: RoomStep[] = item.steps.map((step) => ({ title: step.title, model: shortModel(step.model) }));
  const planned = item.steps.reduce((sum, step) => sum + step.count, 0);
  for (const member of item.members) {
    if (!steps.some((step) => step.title === member.step))
      steps.push({ title: member.step || '…', model: shortModel(member.model) });
  }
  // Steps the script has not reached yet stand their planned hares, waiting, so the whole plan shows from the start.
  const members: TaskForceMember[] = [...item.members, ...placeholders(item)];
  const agents = members.map((member) => ({
    ...member,
    phase: Math.max(
      0,
      steps.findIndex((step) => step.title === (member.step || '…')),
    ),
    handing: false,
  }));
  // A hare that finished walks over to whoever took its answer, while that one has not got far yet.
  for (const agent of agents) {
    if (agent.state !== 'done') continue;
    const taker = agents.find((other) => other.source === agent.id);
    agent.handing = !!taker && (taker.state === 'queued' || (taker.state === 'working' && (taker.turn ?? 0) <= 1));
  }
  return { steps, agents, planned };
}

function placeholders(item: TaskForceItem): TaskForceMember[] {
  if (item.status !== 'proposed' && item.status !== 'running' && item.status !== 'over') return [];
  return item.steps.flatMap((step, i) =>
    Array.from(
      { length: Math.max(0, step.count - item.members.filter((m) => m.step === step.title).length) },
      (_, n) => ({
        id: `plan-${i}-${n}`,
        step: step.title,
        task: '',
        agent: '',
        look: 'antenna' as const,
        color: 2,
        model: step.model,
        state: 'queued' as const,
      }),
    ),
  );
}

/** `anthropic/claude-haiku-5-5` → `haiku`; other names keep what follows the connection. */
export function shortModel(model: string): string {
  const name = model.split('/').pop() ?? model;
  const family = name.match(/claude-(haiku|sonnet|opus|fable)/);
  return family ? family[1]! : name;
}

export function counts(item: TaskForceItem) {
  const done = item.members.filter((m) => m.state === 'done').length;
  const asking = item.members.filter((m) => m.state === 'asking').length;
  return { done, asking, total: item.members.length };
}

/** Whole minutes since 시작, by the clock `now`. */
export function minutesSince(startedAt: string | null, now: number): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000));
}

/** The session's latest TF, if it has one. */
export function latestTaskForce(items: readonly { kind: string }[]): TaskForceItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === 'taskforce') return item as TaskForceItem;
  }
  return null;
}
