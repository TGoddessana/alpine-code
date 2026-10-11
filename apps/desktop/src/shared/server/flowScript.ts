import type { FlowGetResult, FlowNode, ProductMap } from '@alpine/protocol';

import { ServerError } from './connection';
import type { Script } from './scripted';

/** Explicit demo data. Production maps are discovered by the agent, never seeded from this document. */
export const EXAMPLE_MAP: ProductMap = {
  version: 1,
  flows: [
    { id: 'order', title: '상품을 고르고 주문하기', nodeIds: ['browse', 'cart', 'member', 'guest', 'payment'] },
    { id: 'sdk', title: 'SDK로 주문 만들기', nodeIds: ['sdk-call', 'payment', 'receipt'] },
  ],
  nodes: [
    {
      id: 'browse',
      title: '상품 찾기',
      kind: 'screen',
      phase: 'built',
      description: '상품 목록에서 원하는 상품을 고릅니다.',
      example: '오늘의 빵\n소금빵 3,000원\n우유식빵 5,500원',
      sources: ['src/products.tsx'],
    },
    {
      id: 'cart',
      title: '장바구니',
      kind: 'screen',
      phase: 'built',
      description: '수량을 바꾸고 주문을 시작합니다.',
      example: '소금빵 × 3\n합계 9,000원\n[주문하기]',
    },
    {
      id: 'member',
      title: '회원 주문',
      kind: 'process',
      phase: 'built',
      description: '저장된 배송지를 사용합니다.',
      example: '회원 → 배송지 확인 → 주문 생성',
    },
    {
      id: 'guest',
      title: '비회원 주문',
      kind: 'screen',
      phase: 'building',
      description: '가입 없이 배송지를 입력하고 주문합니다.',
      example: '이름 / 연락처 / 배송지\n[주문 계속하기]',
    },
    {
      id: 'payment',
      title: '결제',
      kind: 'api',
      phase: 'built',
      description: '주문 금액을 결제합니다.',
      issue: '쿠폰을 적용하면 결제 금액이 갱신되지 않아요.',
      example: 'POST /payments\nexpected: 8100\nactual: 9000',
      checks: [
        {
          summary: '10% 쿠폰 주문',
          command: 'pnpm test coupon',
          result: 'failed',
          output: 'Expected 8100, received 9000',
          sourceHashes: {},
        },
      ],
    },
    {
      id: 'sdk-call',
      title: '주문 요청',
      kind: 'sdk',
      phase: 'built',
      description: '코드에서 주문을 만듭니다.',
      example: 'client.orders.create({\n  product: "salt-bread",\n  quantity: 3\n})',
    },
    {
      id: 'receipt',
      title: '주문 결과 받기',
      kind: 'data',
      phase: 'planned',
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

export function flowScript(initial: ProductMap = EXAMPLE_MAP): Script {
  const boards = new Map<string, FlowGetResult>();
  let serial = 0;
  const get = (cwd: string) => {
    if (!boards.has(cwd))
      boards.set(cwd, {
        document: structuredClone(initial),
        revision: 'demo-0',
        previews: {},
        staleChecks: ['payment'],
      });
    return boards.get(cwd)!;
  };
  return {
    results: {
      'flow/get': ({ cwd }) => get(cwd),
      'flow/prepare': (params) => {
        const previous = get(params.cwd);
        if (params.revision !== previous.revision)
          throw new ServerError(-32000, 'The map changed.', { reason: 'flow_conflict' });
        const document = structuredClone(previous.document);
        let nodeId = params.nodeId ?? null;
        if (params.action === 'extend') {
          nodeId = `branch-${++serial}`;
          const branch: FlowNode = {
            id: nodeId,
            title: params.request ?? '',
            phase: 'planned',
            kind: 'process',
            sessionId: params.sessionId,
          };
          document.nodes = [...(document.nodes ?? []), branch];
          const flow = document.flows?.find((f) => f.id === params.flowId);
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
        } else if (params.action === 'discover' && !document.nodes?.length) {
          Object.assign(document, structuredClone(EXAMPLE_MAP));
        } else {
          const node = document.nodes?.find((n) => n.id === nodeId);
          if (node) node.sessionId = params.sessionId;
        }
        const board = { ...previous, document, revision: `demo-${++serial}` };
        boards.set(params.cwd, board);
        return { board, nodeId, prompt: `[Product map preview] ${params.action}: ${params.request ?? ''}` };
      },
    },
  };
}
