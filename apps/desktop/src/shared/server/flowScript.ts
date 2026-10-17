import type {
  CheckStamp,
  ErrorData,
  FlowChange,
  FlowCheck,
  FlowCondition,
  FlowGetResult,
  FlowNode,
  MapCoverage,
  NodeState,
  ProductMap,
  PromiseState,
} from '@alpine/protocol';

import { ServerError } from './connection';
import { DEMO_META, demoMeta, type DemoMeta, type PromiseMeta } from './flowExamples';
import type { Script } from './scripted';

const passedCheck = (conditionId: string, expectation: string, command: string) => ({
  id: `chk-${conditionId}`,
  conditionId,
  expectation,
  summary: '예제 실행 기록',
  command,
  result: 'passed' as const,
  output: '1 passed (example)',
  dependsOn: ['src/example.ts'],
});

/** Explicit demo data. Production maps are discovered by the agent, never seeded from this document. */
export const EXAMPLE_MAP: ProductMap = {
  flows: [
    {
      id: 'order',
      title: '상품을 고르고 주문하기',
      description: '손님이 상품을 고르면, 회원이든 비회원이든 결제까지 마칠 수 있어야 한다.',
      trigger: '손님이 가게 앱을 연다',
      nodeIds: ['browse', 'cart', 'member', 'guest', 'payment'],
    },
    {
      id: 'sdk',
      title: '다른 서비스에서 주문 만들기',
      description: '다른 서비스가 주문을 보내면, 결제 결과와 영수증 주소를 받을 수 있어야 한다.',
      trigger: '다른 서비스가 주문을 보낸다',
      nodeIds: ['sdk-call', 'payment', 'receipt'],
    },
  ],
  nodes: [
    {
      id: 'browse',
      title: '상품 찾기',
      kind: 'screen',
      phase: 'built',
      tags: ['상품 탐색'],
      description: '상품 목록에서 원하는 상품을 고릅니다.',
      example: '오늘의 빵\n소금빵 3,000원\n우유식빵 5,500원',
      sources: ['src/products.tsx'],
      conditions: [
        { id: 'list', expectation: '판매 중인 상품만 가격과 함께 보인다.' },
        { id: 'sold-out', expectation: '품절 상품은 담을 수 없다고 표시한다.' },
      ],
      checks: [
        passedCheck('list', '판매 중인 상품만 가격과 함께 보인다.', 'pnpm test products -- list'),
        passedCheck('sold-out', '품절 상품은 담을 수 없다고 표시한다.', 'pnpm test products -- sold-out'),
      ],
    },
    {
      id: 'cart',
      title: '장바구니',
      kind: 'screen',
      phase: 'built',
      tags: ['상품 탐색'],
      description: '수량을 바꾸고 주문을 시작합니다.',
      example: '소금빵 × 3\n합계 9,000원\n[주문하기]',
      conditions: [
        { id: 'total', expectation: '수량을 바꾸면 합계가 바로 바뀐다.' },
        { id: 'empty', expectation: '비어 있으면 주문하기를 누를 수 없다.' },
      ],
      checks: [passedCheck('total', '수량을 바꾸면 합계가 바로 바뀐다.', 'pnpm test cart -- total')],
    },
    {
      id: 'member',
      title: '회원 주문',
      kind: 'process',
      phase: 'built',
      tags: ['주문'],
      description: '저장된 배송지를 사용합니다.',
      example: '회원 → 배송지 확인 → 주문 생성',
      conditions: [{ id: 'address', expectation: '저장된 기본 배송지가 미리 채워진다.' }],
      checks: [passedCheck('address', '저장된 배송지가 미리 채워진다.', 'pnpm test order -- address')],
    },
    {
      id: 'guest',
      title: '비회원 주문',
      kind: 'screen',
      phase: 'building',
      tags: ['주문'],
      description: '가입 없이 배송지를 입력하고 주문합니다.',
      example: '이름 / 연락처 / 배송지\n[주문 계속하기]',
    },
    {
      id: 'payment',
      title: '결제',
      kind: 'api',
      phase: 'built',
      tags: ['결제'],
      description: '주문 금액을 결제합니다.',
      example: 'POST /payments\n{ orderId, amount, coupon }\n→ { paymentId, status }',
      conditions: [
        { id: 'normal', expectation: '쿠폰이 없으면 주문 금액 그대로 결제한다.' },
        { id: 'coupon', expectation: '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.' },
        { id: 'expired', expectation: '만료된 쿠폰은 거절하고 원래 금액을 유지한다.' },
        { id: 'retry', expectation: '결제를 다시 요청해도 중복 청구하지 않는다.' },
      ],
      checks: [
        passedCheck('normal', '쿠폰이 없으면 주문 금액 그대로 결제한다.', 'pnpm test payments -- normal'),
        passedCheck('expired', '만료된 쿠폰은 거절하고 원래 금액을 유지한다.', 'pnpm test payments -- expired'),
        passedCheck('retry', '결제를 다시 요청해도 중복 청구하지 않는다.', 'pnpm test payments -- retry'),
        {
          id: 'chk-coupon',
          conditionId: 'coupon',
          expectation: '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.',
          summary: '10% 쿠폰 주문',
          command: 'pnpm test coupon',
          result: 'failed',
          output: 'Expected 8100, received 9000',
          dependsOn: ['src/payments.ts'],
        },
      ],
    },
    {
      id: 'sdk-call',
      title: '주문 요청',
      kind: 'sdk',
      phase: 'built',
      tags: ['다른 서비스 연동'],
      description: '다른 서비스에서 주문을 만듭니다.',
      example: 'client.orders.create({\n  product: "salt-bread",\n  quantity: 3\n})',
    },
    {
      id: 'receipt',
      title: '주문 결과 받기',
      kind: 'data',
      phase: 'planned',
      tags: ['다른 서비스 연동'],
      description: '주문 번호와 영수증 주소를 반환합니다.',
      example: '{ orderId, receiptUrl }',
    },
  ],
  edges: [
    { source: 'browse', target: 'cart' },
    { source: 'cart', target: 'member', label: '로그인됨' },
    { source: 'cart', target: 'guest', label: '비회원' },
    { source: 'member', target: 'payment' },
    { source: 'guest', target: 'payment' },
    { source: 'sdk-call', target: 'payment' },
    { source: 'payment', target: 'receipt' },
  ],
};

DEMO_META.set(
  EXAMPLE_MAP,
  demoMeta({
    // The user confirmed the coupon rule, so its failure is an open problem rather than a question.
    promises: { 'payment/coupon': { confirmed: true } },
    files: ['src/products.tsx', 'src/payments.ts', 'src/coupons.ts'],
    syncedAt: '2026-10-08T00:00:00Z',
  }),
);

const SESSION_DEFAULT_AT = '2026-10-02T02:20:00Z';
const BLOCKING = new Set(['open', 'regressed', 'maybe_fixed']);

/** Stable key for the exact command and folder, like the real server's approval key. */
const replayKey = (check: FlowCheck) => hash(`${check.replay?.cwd ?? '.'}\0${check.replay?.command ?? check.command}`);

function promiseState(condition: FlowCondition, check: FlowCheck | undefined, meta: PromiseMeta): PromiseState {
  const origin = meta.plan
    ? 'plan'
    : meta.confirmed === true || meta.confirmed === condition.expectation
      ? 'confirmed'
      : 'inferred';
  if (!check)
    return {
      status: 'unconfirmed',
      issue: '',
      origin,
      replay: null,
      written: origin === 'confirmed' && !!meta.written,
    };
  const stamp: CheckStamp = { at: SESSION_DEFAULT_AT, witness: 'mine', ...meta.stamp };
  const changed = meta.changed ?? [];
  const replayHolds =
    !!check.dependsOn?.length && !!meta.replay?.approved && !!meta.replay.current && meta.replay.same === true;
  let status: PromiseState['status'] = check.result;
  if (check.expectation && check.expectation !== condition.expectation) status = 'recheck';
  else if (!check.dependsOn?.length || changed.length || stamp.uncertain)
    status = replayHolds ? check.result : 'recheck';

  const results = [{ result: check.result, at: stamp.at }, ...(meta.older ?? [])];
  const failing = status === 'failed' || (status === 'recheck' && check.result === 'failed');
  let issue: PromiseState['issue'] = '';
  let since: string | null = null;
  let reason = '';
  if (failing && meta.user?.state === 'wontfix') {
    issue = 'wontfix';
    reason = meta.user.reason ?? '';
    since = meta.user.at;
  } else if (failing && meta.user?.state === 'later') {
    issue = meta.user.moved ? 'maybe_fixed' : 'later';
    since = meta.user.at;
  } else if (failing) {
    const streak = results.findIndex((r) => r.result !== 'failed');
    since = results[(streak === -1 ? results.length : streak) - 1]!.at;
    if (origin === 'inferred') issue = 'question';
    else issue = results.slice(1).some((r) => r.result === 'passed') ? 'regressed' : 'open';
    if (changed.length && issue !== 'question' && !replayHolds) issue = 'maybe_fixed';
  } else if (status === 'passed' && results.slice(1).some((r) => r.result === 'failed')) {
    issue = 'resolved';
    since = stamp.at;
  }
  const replay = meta.replay
    ? {
        key: replayKey(check),
        approved: meta.replay.approved,
        running: meta.replay.running ?? false,
        at: meta.replay.at ?? null,
        same: meta.replay.same ?? null,
        output: meta.replay.output ?? '',
      }
    : check.replay
      ? { key: replayKey(check), approved: false }
      : null;
  const reworded = typeof meta.confirmed === 'string' && meta.confirmed !== condition.expectation;
  const decidedElsewhere = !!meta.elsewhere;
  const mine = reworded ? String(meta.confirmed) : '';
  const written = origin === 'confirmed' && !!meta.written;
  return { status, issue, origin, reason, since, stamp, changed, replay, reworded, mine, written, decidedElsewhere };
}

function nodeStates(document: ProductMap, demo: DemoMeta): Record<string, NodeState> {
  const missing = new Set(demo.missing);
  const states: Record<string, NodeState> = {};
  for (const node of document.nodes ?? []) {
    const promises: Record<string, PromiseState> = {};
    for (const condition of node.conditions ?? [])
      promises[condition.id] = promiseState(
        condition,
        node.checks?.find((c) => c.conditionId === condition.id),
        demo.promises[`${node.id}/${condition.id}`] ?? {},
      );
    const list = Object.values(promises);
    const passed = list.filter((p) => p.status === 'passed').length;
    let status: NodeState['status'] = 'passed';
    if (list.some((p) => p.status === 'failed' && BLOCKING.has(p.issue ?? ''))) status = 'failed';
    else if (list.some((p) => p.issue === 'question')) status = 'question';
    else if (list.some((p) => p.status === 'recheck')) status = 'recheck';
    else if (!list.length) status = 'none';
    else if (passed < list.length) status = 'unconfirmed';
    const paths = [...(node.sources ?? []), ...(node.checks ?? []).flatMap((c) => c.dependsOn ?? [])];
    states[node.id] = {
      status,
      passed,
      total: list.length,
      promises,
      changed: list.some((p) => p.changed?.length),
      missing: [...new Set(paths.filter((path) => missing.has(path)))],
    };
  }
  return states;
}

/** Gitignore-like: `**` crosses folders, a pattern without `/` matches a file name, a folder matches what is under it. */
function matchesPattern(pattern: string, path: string): boolean {
  const body = pattern
    .replace(/\/+$/, '')
    .split('**/')
    .map((part) =>
      part
        .split('**')
        .map((piece) =>
          piece
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]'),
        )
        .join('.*'),
    )
    .join('(?:.*/)?');
  const target = pattern.includes('/') ? path : (path.split('/').pop() ?? path);
  return new RegExp(`^${body}(?:/.*)?$`).test(target);
}

const under = (path: string, base: string) => path === base || path.startsWith(`${base.replace(/\/$/, '')}/`);

function coverageOf(document: ProductMap, demo: DemoMeta): MapCoverage {
  if (!demo.git) return { git: false };
  const covers = (document.nodes ?? []).flatMap((n) => [
    ...(n.sources ?? []),
    ...(n.checks ?? []).flatMap((c) => c.dependsOn ?? []),
  ]);
  const uncovered: string[] = [];
  let outOfScope = 0;
  let excluded = 0;
  for (const file of demo.files) {
    if (demo.include.length && !demo.include.some((base) => under(file, base))) outOfScope++;
    else if (demo.exclude.some((pattern) => matchesPattern(pattern, file))) excluded++;
    else if (!covers.some((base) => under(file, base))) uncovered.push(file);
  }
  return {
    git: true,
    uncovered: uncovered.slice(0, 200),
    uncoveredCount: uncovered.length,
    outOfScope,
    excluded,
    since: demo.syncedAt,
  };
}

const hash = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
};
const fail = (message: string, reason: ErrorData['reason']) => new ServerError(-32000, message, { reason });

interface Board {
  revision: string;
  document: ProductMap;
  meta: DemoMeta;
  changes: FlowChange[];
}

/** `initial` may differ per project folder, so a browser preview can show several kinds of maps side by side. */
export function flowScript(initial: ProductMap | ((cwd: string) => ProductMap) = EXAMPLE_MAP): Script {
  const boards = new Map<string, Board>();
  let serial = 0;
  const open = (map: ProductMap): Board => {
    const meta = structuredClone(DEMO_META.get(map) ?? demoMeta());
    return { revision: 'demo-0', document: structuredClone(map), meta, changes: structuredClone(meta.changes) };
  };
  const get = (cwd: string) => {
    if (!boards.has(cwd)) boards.set(cwd, open(typeof initial === 'function' ? initial(cwd) : initial));
    return boards.get(cwd)!;
  };
  /** Appends a change (newest first) the way the real server's history file does. */
  const record = (board: Board, nodeId: string, title: string, kind: FlowChange['kind'], detail = '') => {
    board.changes = [{ at: new Date().toISOString(), nodeId, title, kind, detail }, ...board.changes].slice(0, 200);
  };
  const writable = (board: Board) => {
    if (board.meta.readOnly) throw fail('The map was made by a newer version.', 'map_read_only');
    return board;
  };
  const touch = (board: Board) => void (board.revision = `demo-${++serial}`);
  const view = (board: Board): FlowGetResult => {
    const { document, meta } = board;
    const result: FlowGetResult = {
      revision: board.revision,
      exists: !!(document.nodes?.length || document.flows?.length),
      readOnly: meta.readOnly,
      document,
      previews: meta.previews,
      changes: board.changes,
      states: nodeStates(document, meta),
      // The demo declares each label by hand; the real server computes them from the session log.
      provenance: meta.provenance,
      coverage: coverageOf(document, meta),
      include: meta.include,
      exclude: meta.exclude,
      problems: meta.problems,
      schedule: meta.schedule,
      unmapped: meta.unmapped,
    };
    return { ...result, etag: hash(JSON.stringify(result)) };
  };
  const find = (board: Board, nodeId: string) => {
    const node = board.document.nodes?.find((n) => n.id === nodeId);
    if (!node) throw fail('Unknown map node', 'invalid_flow');
    return node;
  };

  return {
    results: {
      'flow/get': ({ cwd, since }) => {
        const board = get(cwd);
        const result = view(board);
        return since && since === result.etag
          ? { revision: result.revision, etag: result.etag, unchanged: true }
          : result;
      },
      'flow/node': ({ cwd, nodeId }) => {
        const { meta } = get(cwd);
        const pick = (table: Record<string, string>) =>
          Object.fromEntries(
            Object.entries(table)
              .filter(([key]) => key.startsWith(`${nodeId}/`))
              .map(([key, value]) => [key.slice(nodeId.length + 1), value]),
          );
        return { checkScreenshots: pick(meta.shots), observationImages: pick(meta.images) };
      },
      'flow/set': (params) => {
        const board = writable(get(params.cwd));
        const node = find(board, params.nodeId);
        const { document } = board;
        if (params.field === 'priority' && params.value && !['must', 'should', 'later'].includes(params.value))
          throw fail('Unknown priority', 'invalid_flow');
        if (params.field === 'scope' && params.value && !['now', 'next', 'out'].includes(params.value))
          throw fail('Unknown scope', 'invalid_flow');
        if (params.field === 'decision') node.decision = params.value ?? '';
        else if (params.field === 'priority') node.priority = params.value as FlowNode['priority'];
        else node.scope = params.value as FlowNode['scope'];
        board.document = structuredClone(document);
        touch(board);
        return view(board);
      },
      'flow/promise': (params) => {
        const board = writable(get(params.cwd));
        const node = find(board, params.nodeId);
        const condition = node.conditions?.find((c) => c.id === params.conditionId);
        if (!condition) throw fail('Unknown promise', 'invalid_flow');
        const key = `${node.id}/${condition.id}`;
        const meta = (board.meta.promises[key] ??= {});
        const now = new Date().toISOString();
        const note = (kind: FlowChange['kind'], detail = condition.expectation) =>
          record(board, node.id, node.title, kind, detail);
        if (params.action === 'confirm') {
          meta.confirmed = true;
          note('promise_confirmed');
        } else if (params.action === 'unconfirm') {
          meta.confirmed = false;
        } else if (params.action === 'later') {
          meta.user = { state: 'later', at: now };
          note('issue_later');
        } else if (params.action === 'wontfix') {
          const reason = params.reason?.trim();
          if (!reason) throw fail('A reason is required.', 'reason_required');
          meta.user = { state: 'wontfix', reason, at: now };
          note('issue_wontfix', reason);
        } else if (params.action === 'reopen') {
          meta.user = undefined;
          note('issue_reopened');
        } else if (params.action === 'approve_replay') {
          const check = node.checks?.find((c) => c.conditionId === condition.id);
          if (check && params.key !== replayKey(check)) throw fail('The command changed.', 'replay_changed');
          meta.elsewhere = false;
          meta.replay = { ...meta.replay, approved: true };
        } else {
          meta.replay = { ...meta.replay, approved: false, running: false };
        }
        touch(board);
        return view(board);
      },
      'flow/edit': (params) => {
        const board = writable(get(params.cwd));
        const node = find(board, params.nodeId);
        const value = (params.value ?? '').trim();
        if (params.field === 'title') {
          if (!value) throw fail('Write the title', 'invalid_flow');
          node.title = value;
        } else if (params.field === 'how_to_try') {
          node.howToTry = value;
        } else if (params.conditionId) {
          const condition = node.conditions?.find((c) => c.id === params.conditionId);
          if (!condition) throw fail('Unknown promise', 'invalid_flow');
          const key = `${node.id}/${condition.id}`;
          if (value) {
            condition.expectation = value;
            board.meta.promises[key] = { ...board.meta.promises[key], confirmed: value, written: true };
          } else {
            node.conditions = node.conditions?.filter((c) => c !== condition);
            node.checks = node.checks?.filter((c) => c.conditionId !== condition.id);
            delete board.meta.promises[key];
          }
        } else {
          if (!value) throw fail('Write the promise', 'invalid_flow');
          const id = `user-${++serial}`;
          node.conditions = [...(node.conditions ?? []), { id, expectation: value }];
          board.meta.promises[`${node.id}/${id}`] = { confirmed: value, written: true };
        }
        board.document = structuredClone(board.document);
        touch(board);
        return view(board);
      },
      'flow/review': (params) => {
        const board = writable(get(params.cwd));
        // The demo only knows reworded promises; removed cards, fields and map reviews come from the real server.
        if (params.target !== 'promise' || !params.nodeId || !params.conditionId)
          throw fail('Nothing to review', 'invalid_flow');
        const node = find(board, params.nodeId);
        const condition = node.conditions?.find((c) => c.id === params.conditionId);
        const meta = board.meta.promises[`${node.id}/${params.conditionId}`];
        if (!condition || typeof meta?.confirmed !== 'string') throw fail('Nothing to review', 'invalid_flow');
        if (params.action === 'accept') meta.confirmed = condition.expectation;
        else condition.expectation = meta.confirmed;
        board.document = structuredClone(board.document);
        touch(board);
        return view(board);
      },
      'flow/delete': ({ cwd }) => {
        const board = writable(get(cwd));
        board.document = { nodes: [], flows: [], edges: [] };
        board.changes = [];
        touch(board);
        return view(board);
      },
      'flow/scope': ({ cwd, include }) => {
        const board = writable(get(cwd));
        board.meta.include = [
          ...new Set(
            (include ?? [])
              .map((path) =>
                path
                  .trim()
                  .replace(/^(\.\/)+/, '')
                  .replace(/\/+$/, ''),
              )
              .filter((path) => path && path !== '.' && !path.startsWith('..')),
          ),
        ];
        touch(board);
        return view(board);
      },
      'flow/schedule': ({ cwd, enabled, limit, ran }) => {
        const board = get(cwd); // allowed on a read-only map: the schedule belongs to this computer
        const last = board.meta.schedule.lastRun ? Date.parse(board.meta.schedule.lastRun) : NaN;
        if (ran && Date.now() - last < 24 * 3_600_000) throw fail('Already started today.', 'flow_conflict');
        board.meta.schedule = {
          enabled,
          limit: limit ?? board.meta.schedule.limit ?? 20,
          lastRun: ran ? new Date().toISOString() : (board.meta.schedule.lastRun ?? null),
        };
        touch(board);
        return view(board);
      },
      'flow/prepare': (params) => {
        const board = writable(get(params.cwd));
        if (params.revision !== board.revision) throw fail('The map changed.', 'flow_conflict');
        const document = structuredClone(board.document);
        if (params.nodeId) find(board, params.nodeId);
        for (const id of params.nodeIds ?? []) find(board, id);
        const flow = document.flows?.find((f) => f.id === params.flowId);
        if (params.flowId && !flow) throw fail('Unknown flow', 'invalid_flow');
        if (params.action === 'verify' && !params.nodeId && !flow && !params.nodeIds?.length)
          throw fail('Select a feature or flow first', 'invalid_flow');
        let nodeId = params.nodeId ?? null;
        board.document = document;
        if (params.action === 'extend') {
          nodeId = `branch-${++serial}`;
          const branch: FlowNode = {
            id: nodeId,
            title: params.request ?? '',
            phase: 'planned',
            kind: 'process',
            tags: document.nodes?.find((n) => n.id === params.nodeId)?.tags,
            sessionId: params.sessionId,
          };
          document.nodes = [...(document.nodes ?? []), branch];
          if (flow) flow.nodeIds = [...(flow.nodeIds ?? []), nodeId];
          else
            document.flows = [
              ...(document.flows ?? []),
              {
                id: `flow-${serial}`,
                title: params.request ?? '',
                nodeIds: [...(params.nodeId ? [params.nodeId] : []), nodeId],
              },
            ];
          if (params.nodeId) document.edges = [...(document.edges ?? []), { source: params.nodeId, target: nodeId }];
          record(board, nodeId, params.request ?? '', 'added', 'planned');
        } else if (params.action === 'discover' && !document.nodes?.length) {
          Object.assign(board, open(EXAMPLE_MAP), { revision: board.revision });
        } else {
          for (const id of [nodeId, ...(params.nodeIds ?? [])]) {
            const node = document.nodes?.find((n) => n.id === id);
            if (node) node.sessionId = params.sessionId;
          }
        }
        touch(board);
        const lines = [`[Product map preview] ${params.action}: ${params.request ?? ''}`];
        if (params.nodeIds?.length) lines.push(`cards: ${params.nodeIds.length}`);
        if (params.action === 'sync') lines.push(...(coverageOf(board.document, board.meta).uncovered ?? []));
        return { board: view(board), nodeId, prompt: lines.join('\n') };
      },
    },
  };
}
