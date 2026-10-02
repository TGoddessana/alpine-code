import type { ApprovalItem, CheckDetail, Plan, SessionInfo, ToolCallItem } from '@alpine/protocol';

import { check, planChange, step } from './planShapes';
import type { Item } from './sessionState';
import { sessionInfo } from './sessionScript';

function call(
  id: string,
  name: string,
  args: Record<string, unknown>,
  result: string | null,
  over: Partial<ToolCallItem> = {},
): ToolCallItem {
  return { id, kind: 'tool_call', name, args, status: 'done', result, images: 0, detail: null, ...over };
}

function checkCall(id: string, label: string, detail: Omit<CheckDetail, 'kind' | 'label'>, result: string) {
  return call(id, 'check', { label }, result, { detail: { kind: 'check', label, ...detail } });
}

const lines = (count: number, text: (i: number) => string) =>
  Array.from({ length: count }, (_, i) => `${String(i + 1).padStart(4)}\t${text(i)}`).join('\n');

const DIFF = [
  '--- a/tests/core/test_session_index.py',
  '+++ b/tests/core/test_session_index.py',
  '@@ -0,0 +1,40 @@',
  '+def test_broken_index_rebuilds_from_disk(tmp_path):',
  '+    write_sessions(tmp_path, ["s1", "s2", "s3"])',
  '+    (tmp_path / "index.json").write_text("{broken")',
  ...Array.from({ length: 37 }, (_, i) => `+    # line ${i + 4}`),
].join('\n');

const edit: ApprovalItem = {
  id: 'w-edit-req',
  kind: 'approval',
  callId: 'w-edit',
  title: 'Create tests/core/test_session_index.py',
  preview: DIFF,
  previewKind: 'diff',
  reason: null,
  remember: 'write',
  decision: 'allow',
  feedback: null,
  tool: 'write',
  args: { path: 'tests/core/test_session_index.py' },
};

/** Board Task2Work: the plan's second step under way, its checks not run yet, a reproduction test that fails. */
export const WORK_PLAN: Plan = {
  steps: [
    step('원인 경로 찾기', 'done'),
    step('재현 테스트 먼저', 'now'),
    step('인덱스 다시 만들기'),
    step('전체 테스트로 검증'),
    step('검토로 넘기기'),
  ],
  dropped: [],
  checks: [
    check('테스트', 'harness', { command: 'uv run pytest' }),
    check('자체 검토', 'agent', { how: '바꾼 줄을 다시 읽고 빠진 경우 찾기' }),
    check('직접 확인', 'user', { how: '앱을 다시 켜고 목록 보기' }),
  ],
};

export const WORK_ITEMS: Item[] = [
  {
    id: 'w-user',
    kind: 'user_message',
    text: '세션 목록이 가끔 사라지는 문제 고쳐 줘. 디스크엔 기록이 남아 있는데 목록에서만 안 보여.',
  },
  call(
    'w-read-1',
    'read',
    { path: 'core/session.py' },
    lines(112, (i) => `# session ${i}`),
  ),
  call(
    'w-read-2',
    'read',
    { path: 'core/session_index.py' },
    lines(64, (i) => `# index ${i}`),
  ),
  call('w-plan-1', 'update_plan', {}, 'Plan updated: 5 steps, 3 checks.', {
    detail: planChange({ created: true, steps: 5, checks: 3, started: ['원인 경로 찾기'] }),
  }),
  {
    id: 'w-say-1',
    kind: 'agent_message',
    text: '원인을 찾았어요. 파싱이 실패하면 오류 없이 빈 목록을 돌려줘서, 디스크에 기록이 있어도 목록이 비어 보여요.',
  },
  { id: 'w-say-2', kind: 'agent_message', text: '고치기 전에 문제를 재현하는 테스트부터 만들고 있어요.' },
  call('w-plan-2', 'update_plan', {}, 'Plan updated: 5 steps, 3 checks.', {
    detail: planChange({ steps: 5, checks: 3, finished: ['원인 경로 찾기'], started: ['재현 테스트 먼저'] }),
  }),
  edit,
  call('w-edit', 'write', { path: 'tests/core/test_session_index.py' }, 'Created tests/core/test_session_index.py'),
  call(
    'w-read-3',
    'read',
    { path: 'core/session.py' },
    lines(112, (i) => `# session ${i}`),
  ),
  call(
    'w-run',
    'bash',
    { command: 'uv run pytest tests/core/test_session_index.py' },
    [
      'FAILED tests/core/test_session_index.py::test_broken_index_rebuilds_from_disk',
      "AssertionError: assert [] == ['s1', 's2', 's3']",
      " +  where [] = load_index(PosixPath('/tmp/pytest-7/index.json'))",
      '1 failed, 3 passed in 0.42s',
      '',
      '=========================== short test summary info ============================',
      'FAILED tests/core/test_session_index.py::test_broken_index_rebuilds_from_disk',
      '[exit code 1]',
    ].join('\n'),
    { status: 'error' },
  ),
];

/** Board StressMonorepo: two packages' checks passed, the third could not run; one step left the plan. */
export const MONOREPO_PLAN: Plan = {
  steps: [
    step('주문 목록 쿼리에 커서 추가', 'done'),
    step('공용 타입에 PageInfo 추가', 'done'),
    step('영향받는 패키지 테스트', 'now'),
    step('검토로 넘기기'),
  ],
  dropped: ['e2e 테스트 새로 쓰기'],
  checks: [
    check('테스트 · web', 'harness', { command: 'pnpm -F web test', result: 'passed', evidence: ['m-check-web'] }),
    check('테스트 · types', 'harness', {
      command: 'pnpm -F types tsc --noEmit',
      result: 'passed',
      evidence: ['m-check-types'],
    }),
    check('테스트 · api', 'harness', { command: 'pnpm -F api test' }),
  ],
};

export const MONOREPO_ITEMS: Item[] = [
  { id: 'm-user', kind: 'user_message', text: '주문 목록 API에 커서 페이지네이션을 넣어 줘.' },
  call('m-run-1', 'bash', { command: 'pnpm -r ls --depth -1' }, 'packages/api\npackages/types\napps/web'),
  call('m-edit-1', 'edit', { path: 'packages/api/src/routes/orders.ts' }, 'Edited packages/api/src/routes/orders.ts'),
  call('m-edit-2', 'edit', { path: 'packages/types/src/pagination.ts' }, 'Edited packages/types/src/pagination.ts'),
  call('m-plan-1', 'update_plan', {}, 'Plan updated: 4 steps, 3 checks.', {
    detail: planChange({
      steps: 4,
      checks: 3,
      finished: ['주문 목록 쿼리에 커서 추가', '공용 타입에 PageInfo 추가'],
      started: ['영향받는 패키지 테스트'],
      dropped: ['e2e 테스트 새로 쓰기'],
    }),
  }),
  call('m-run-2', 'bash', { command: 'git diff --stat' }, ' 2 files changed, 60 insertions(+), 6 deletions(-)'),
  {
    id: 'm-say-1',
    kind: 'agent_message',
    text: '주문 목록 쿼리에 커서를 추가하고(packages/api), 공용 타입에 PageInfo를 넣었어요(packages/types).',
  },
  checkCall(
    'm-check-web',
    '테스트 · web',
    { judge: 'harness', passed: true, evidence: ['m-check-web'] },
    ' Test Files  12 passed (12)\n      Tests  84 passed (84)\n[check passed]',
  ),
  checkCall(
    'm-check-types',
    '테스트 · types',
    { judge: 'harness', passed: true, evidence: ['m-check-types'] },
    'Found 0 errors.\n[check passed]',
  ),
  call(
    'm-docker',
    'bash',
    { command: 'docker info' },
    'Error: Cannot connect to the Docker daemon at unix:///var/run/docker.sock.\nIs the docker daemon running?\n[exit code 1]',
    { status: 'error' },
  ),
  { id: 'm-say-2', kind: 'agent_message', text: 'Docker가 꺼져 있어서 api 테스트를 못 돌렸어요.' },
];

/** Board StressFrontend's checks: an agent's judgement with evidence, a failure, one changed since it passed. */
export const JUDGED_PLAN: Plan = {
  steps: [step('배지 넣기', 'done'), step('세 화면에서 확인', 'done'), step('검토로 넘기기', 'now')],
  dropped: [],
  checks: [
    check('타입 검사', 'harness', { command: 'pnpm tsc --noEmit', result: 'passed', evidence: ['f-1'] }),
    check('린트', 'harness', { command: 'pnpm lint', result: 'failed', evidence: ['f-2'] }),
    check('화면 · 배지가 가격과 안 겹침', 'agent', {
      how: '390 · 768 · 1280 캡처',
      result: 'passed',
      evidence: ['f-3', 'f-4', 'f-5'],
      note: '세 크기 모두 겹치지 않아요',
    }),
    check('단위 테스트', 'harness', { command: 'pnpm test', result: 'changed', evidence: ['f-6'] }),
    check('화면 비교', 'user', { how: '전후 캡처' }),
  ],
};

export const JUDGED_ITEMS: Item[] = [
  { id: 'f-user', kind: 'user_message', text: '상품 카드에 할인 배지 넣어 줘.' },
  checkCall(
    'f-1',
    '타입 검사',
    { judge: 'harness', passed: true, evidence: ['f-1'] },
    'Found 0 errors.\n[check passed]',
  ),
  checkCall(
    'f-2',
    '린트',
    { judge: 'harness', passed: false, evidence: ['f-2'] },
    [
      'src/components/ProductCard.tsx',
      "  21:9  error  'discount' is possibly undefined  @typescript-eslint/no-unsafe-member-access",
      '  34:1  error  Unexpected console statement  no-console',
      '',
      '✖ 2 problems (2 errors, 0 warnings)',
      '[exit code 1: check failed]',
    ].join('\n'),
  ),
  checkCall(
    'f-7',
    '화면 · 배지가 가격과 안 겹침',
    { judge: 'agent', passed: true, evidence: ['f-3', 'f-4', 'f-5'] },
    "Recorded: '화면 · 배지가 가격과 안 겹침' passed, as your judgement with 3 calls as evidence.",
  ),
];

/** The example sessions with a plan, as the scripted server keeps them (idle: nothing runs them). */
export const PLAN_SESSIONS: { info: SessionInfo; items: Item[] }[] = [
  {
    info: sessionInfo({ id: 's-plan-work', title: '세션 목록이 사라지는 문제', plan: WORK_PLAN }),
    items: WORK_ITEMS,
  },
  {
    info: sessionInfo({
      id: 's-plan-monorepo',
      title: '주문 API 페이지네이션',
      cwd: '/Users/me/acme',
      plan: MONOREPO_PLAN,
    }),
    items: MONOREPO_ITEMS,
  },
];
