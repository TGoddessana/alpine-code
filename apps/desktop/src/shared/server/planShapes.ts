import type { PlanCheck, PlanStep, PlanUpdateDetail } from '@alpine/protocol';

/** A step of a plan, for fixtures. */
export const step = (text: string, status: PlanStep['status'] = 'todo'): PlanStep => ({ text, status });

/** A check of a plan, for fixtures: not run, unless `over` says otherwise. */
export function check(label: string, judge: PlanCheck['judge'], over: Partial<PlanCheck> = {}): PlanCheck {
  return {
    label,
    judge,
    command: judge === 'harness' ? 'pnpm test' : null,
    how: null,
    result: 'not_run',
    evidence: [],
    note: null,
    ...over,
  };
}

/** What an `update_plan` call changed, for fixtures: nothing, unless `over` says otherwise. */
export function planChange(over: Partial<PlanUpdateDetail> = {}): PlanUpdateDetail {
  return {
    kind: 'plan',
    created: false,
    steps: 0,
    checks: 0,
    finished: [],
    started: [],
    reopened: [],
    added: [],
    renamed: [],
    dropped: [],
    checksChanged: false,
    ...over,
  };
}
