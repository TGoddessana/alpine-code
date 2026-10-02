import { describe, expect, it } from 'vitest';

import { check, step } from '@/shared/server';

import { planCounts } from './PlanParts';

describe('planCounts', () => {
  it('counts steps done, checks passed and steps dropped', () => {
    const plan = {
      steps: [step('a', 'done'), step('b', 'now'), step('c')],
      dropped: ['d'],
      checks: [
        check('t', 'harness', { result: 'passed' }),
        check('u', 'user'),
        check('v', 'agent', { result: 'failed' }),
      ],
    };
    expect(planCounts(plan)).toEqual({ plan: [1, 3], verification: [1, 3], unusual: 1 });
  });

  it('has nothing to count without a plan, steps or checks', () => {
    expect(planCounts(null)).toEqual({ plan: null, verification: null, unusual: 0 });
    expect(planCounts({ steps: [], dropped: [], checks: [] })).toEqual({ plan: null, verification: null, unusual: 0 });
  });
});
