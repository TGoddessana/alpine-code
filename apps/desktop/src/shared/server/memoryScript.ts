import type { MemoryEvidence, MemoryInfo, MemoryListResult } from '@alpine/protocol';

import { ServerError } from './connection';
import type { Script } from './scripted';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const said = (quote: string, days: number, sessionId = 's-old-1'): MemoryEvidence => ({
  sessionId,
  at: daysAgo(days),
  quote,
});

/** The suggestion the scripted session `s-old-1` made: its chat shows it as a card. */
export const MEMORY_SUGGESTION = {
  id: 'sg-1',
  kind: 'rule',
  scope: 'team',
  headline: '화면 문구는 해요체로 쓴다',
  body: '이유: 버튼과 오류 메시지를 두 번 고쳐 말했어요.\n예: "저장하기" → "저장해요", "실패했습니다" → "실패했어요"',
  replaces: [],
  evidence: [said('버튼 문구는 해요체로 해줘', 0)],
  source: 'agent',
  remove: false,
} as const satisfies MemoryListResult['pending'][number];

/** A memory naming a file that was deleted, and the harness's suggestion to remove it. */
const PAY_CODE: MemoryInfo = {
  id: 'pay-code',
  kind: 'fact',
  scope: 'team',
  headline: '결제 코드는 `src/pay/toss.ts`에 있다',
  body: '토스페이먼츠 위젯을 여기서 불러요.',
  path: '/Users/me/alpine-code/.alpine/memory/pay-code.md',
  evidence: [said('결제 코드 어디 있어?', 30)],
  saidAgain: [],
};

export const MEMORY_REMOVAL = {
  id: 'sg-2',
  kind: 'fact',
  scope: 'team',
  headline: PAY_CODE.headline,
  body: PAY_CODE.body,
  replaces: ['pay-code'],
  evidence: [said('src/pay/toss.ts', 0)],
  source: 'missing_paths',
  remove: true,
} as const satisfies MemoryListResult['pending'][number];

/** A project that has learned a few things, one of them said again after it was approved. */
export const MEMORY: MemoryListResult = {
  pending: [MEMORY_SUGGESTION, MEMORY_REMOVAL],
  memories: [
    PAY_CODE,
    {
      id: 'lint-before-commit',
      kind: 'rule',
      scope: 'team',
      headline: '커밋 전에 `pnpm lint`를 돌린다',
      body: '이유: CI가 lint 단계에서 실패해 PR이 막힌 적이 있어요.\n예: apps/desktop은 `pnpm -F desktop lint`로 따로 돌려요.',
      path: '/Users/me/alpine-code/.alpine/memory/lint-before-commit.md',
      evidence: [said('커밋하기 전에 린트 좀 돌려', 12)],
      saidAgain: [said('또 린트 안 돌렸네', 3, 's-old-2'), said('린트!', 1)],
      check: {
        when: 'before command "git commit"',
        expect: 'command "pnpm lint" ran after the last change',
        say: '커밋 전에 `pnpm lint`를 먼저 돌려 주세요.',
      },
    },
    {
      id: 'prod-db',
      kind: 'rule',
      scope: 'team',
      headline: '운영 DB에는 직접 SQL을 실행하지 않는다',
      body: '이유: 9/20에 운영 데이터를 잘못 지워 백업에서 되살렸어요. 바꿀 땐 마이그레이션으로 해요.',
      path: '/Users/me/alpine-code/.alpine/memory/prod-db.md',
      evidence: [said('운영 DB 건드리지 마', 16)],
      saidAgain: [],
      guard: { before: 'command "supabase db execute --linked"', say: '운영 DB에 직접 SQL을 실행하려고 해요.' },
    },
    {
      id: 'deploy',
      kind: 'fact',
      scope: 'team',
      headline: '배포는 Vercel, 운영 DB는 Supabase `flower-prod`',
      body: 'main에 push하면 Vercel이 배포해요. 미리보기 DB는 `flower-dev`예요.',
      path: '/Users/me/alpine-code/.alpine/memory/deploy.md',
      evidence: [said('배포 어디서 돼?', 9)],
      saidAgain: [],
    },
    {
      id: 'rls-empty',
      kind: 'lesson',
      scope: 'team',
      headline: '예약이 화면에 안 보이면 → Supabase RLS 정책부터 확인',
      body: '9/22에 2시간 걸린 문제예요. 데이터는 있었는데 `bookings` 테이블에 읽기 정책이 없었어요.',
      path: '/Users/me/alpine-code/.alpine/memory/rls-empty.md',
      evidence: [said('예약이 왜 안 보이지', 14)],
      saidAgain: [],
    },
    {
      id: 'test-payments',
      kind: 'rule',
      scope: 'project_me',
      headline: '결제 테스트는 토스 테스트 키로만 한다',
      body: '',
      path: '/Users/me/.alpine-code/projects/alpine-code-1a2b3c4d/memory/test-payments.md',
      evidence: [said('내 카드로 결제 테스트하지 마', 5)],
      saidAgain: [],
    },
    {
      id: 'plain-words',
      kind: 'user',
      scope: 'me',
      headline: '코드를 잘 모르니 설명은 쉬운 말로',
      body: '',
      path: '/Users/me/.alpine-code/memory/plain-words.md',
      evidence: [said('좀 쉽게 말해줘', 20)],
      saidAgain: [],
    },
  ],
};

/**
 * The `memory/*` methods over memories kept in the script, by project. Approving, declining and forgetting change
 * them and announce `memory/changed`, as the server does. Projects not in `start` have no memory yet.
 */
export function memoryScript(start: Record<string, MemoryListResult> = { '/Users/me/alpine-code': MEMORY }): Script {
  const state = new Map(Object.entries(start).map(([cwd, list]) => [cwd, structuredClone(list)]));
  const of = (cwd: string) => state.get(cwd) ?? { memories: [], pending: [] };

  return {
    results: {
      'memory/list': ({ cwd }) => structuredClone(of(cwd)),
      'memory/approve': ({ cwd, suggestionId }, context) => {
        const list = of(cwd);
        const suggestion = list.pending.find((s) => s.id === suggestionId);
        if (!suggestion) throw new ServerError(-32000, 'No such suggestion', { reason: 'not_found' });
        if (suggestion.remove) {
          const gone = list.memories.find((m) => m.id === suggestion.replaces[0])!;
          state.set(cwd, {
            pending: list.pending.filter((s) => s !== suggestion),
            memories: list.memories.filter((m) => m !== gone),
          });
          context.emit({ method: 'memory/changed', params: { cwd } });
          return { memory: gone };
        }
        const memory: MemoryInfo = {
          id: suggestion.replaces[0] ?? suggestionId,
          kind: suggestion.kind,
          scope: suggestion.scope,
          headline: suggestion.headline,
          body: suggestion.body,
          path: null,
          evidence: suggestion.evidence,
          saidAgain: [],
        };
        state.set(cwd, {
          pending: list.pending.filter((s) => s !== suggestion),
          memories: [...list.memories.filter((m) => !suggestion.replaces.includes(m.id)), memory],
        });
        context.emit({ method: 'memory/changed', params: { cwd } });
        return { memory };
      },
      'memory/reject': ({ cwd, suggestionId }, context) => {
        const list = of(cwd);
        state.set(cwd, { ...list, pending: list.pending.filter((s) => s.id !== suggestionId) });
        context.emit({ method: 'memory/changed', params: { cwd } });
        return {};
      },
      'memory/forget': ({ cwd, scope, memoryId }, context) => {
        const list = of(cwd);
        state.set(cwd, {
          ...list,
          memories: list.memories.filter((m) => !(m.scope === scope && m.id === memoryId)),
        });
        context.emit({ method: 'memory/changed', params: { cwd } });
        return {};
      },
    },
  };
}
