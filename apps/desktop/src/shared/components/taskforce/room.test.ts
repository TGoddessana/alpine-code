import { describe, expect, it } from 'vitest';

import { overPlanned, taskForceAt } from './fixtures';
import { latestTaskForce, minutesSince, roomOf, shortModel } from './room';

describe('roomOf', () => {
  it('stands the whole plan waiting before 시작', () => {
    const room = roomOf(taskForceAt(-1));
    expect(room.steps.map((s) => `${s.title} ${s.model}`)).toEqual([
      '조사 haiku',
      '작성 haiku',
      '검토 opus',
      '조립 haiku',
    ]);
    expect(room.agents).toHaveLength(14);
    expect(room.agents.every((a) => a.state === 'queued' && a.task === '')).toBe(true);
  });

  it('puts each agent in its step and fills the steps not reached yet with planned hares', () => {
    const room = roomOf(taskForceAt(10));
    const reviewers = room.agents.filter((a) => a.phase === 2);
    expect(reviewers).toHaveLength(6);
    expect(reviewers.every((a) => a.task === '')).toBe(true);
    expect(room.agents.filter((a) => a.phase === 1 && a.task !== '')).toHaveLength(6);
  });

  it('walks a finished writer over while its reviewer has not started', () => {
    const room = roomOf(taskForceAt(14)); // the first writer is done, its reviewer waits
    const writer = room.agents.find((a) => a.id === 'a2')!;
    expect(writer.state).toBe('done');
    expect(writer.handing).toBe(true);
    expect(roomOf(taskForceAt(18)).agents.find((a) => a.id === 'a2')!.handing).toBe(false);
  });

  it('adds a step the script named that the plan did not', () => {
    const item = overPlanned();
    const extra = { ...item.members[0]!, id: 'x', step: '빠진 곳 찾기' };
    expect(roomOf({ ...item, members: [...item.members, extra] }).steps.at(-1)!.title).toBe('빠진 곳 찾기');
  });
});

describe('helpers', () => {
  it('shortens model names, counts minutes and finds the latest TF', () => {
    expect(shortModel('anthropic/claude-opus-5-5')).toBe('opus');
    expect(shortModel('local/qwen3')).toBe('qwen3');
    expect(minutesSince('2026-10-19T00:00:00Z', Date.parse('2026-10-19T00:14:59Z'))).toBe(14);
    expect(minutesSince(null, Date.now())).toBe(0);
    expect(latestTaskForce([{ kind: 'user_message' }, taskForceAt(-1), { kind: 'agent_message' }])?.id).toBe(
      'tf-postgres',
    );
  });
});
