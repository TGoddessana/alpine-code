import { describe, expect, it } from 'vitest';

import type { PlanUpdateDetail } from '@alpine/protocol';

import { planChange } from '@/shared/server';

import { messages } from './messages';
import { planChangeText } from './planText';

const text = (over: Partial<PlanUpdateDetail>) =>
  planChangeText(messages.ko, planChange({ steps: 5, checks: 3, ...over }), String);

describe('planChangeText', () => {
  it('says how big the first plan is, and nothing else', () => {
    expect(text({ created: true, started: ['원인 찾기'] })).toBe('5단계 세움 · 확인 3개');
    expect(text({ created: true, checks: 0 })).toBe('5단계 세움');
  });

  it('says only what changed after that', () => {
    expect(text({ finished: ['원인 찾기'], started: ['고치기'] })).toBe("'원인 찾기' 끝냄 · '고치기' 시작");
    expect(text({ dropped: ['재현 테스트 먼저'] })).toBe("'재현 테스트 먼저' 뺌");
    expect(text({ added: ['검토'], renamed: [{ before: 'a', after: 'b' }], checksChanged: true, checks: 2 })).toBe(
      "'검토' 추가 · 'a' → 'b' · 확인 2개로 바꿈",
    );
    expect(text({})).toBe('바뀐 것 없음');
  });

  it('does not add a step it just started a second time', () => {
    expect(text({ added: ['검토'], started: ['검토'] })).toBe("'검토' 시작");
  });
});
