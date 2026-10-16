import type {
  CheckStamp,
  FlowChange,
  FlowCheck,
  FlowCondition,
  FlowNode,
  MapProblem,
  MapSchedule,
  Observation,
  ObservationProvenance,
  ProductMap,
  UnmappedPart,
} from '@alpine/protocol';

/*
 * What the real server knows from Alpine's own state files, the local witness store and git. A map document alone
 * cannot say it, so each demo map is registered with this metadata and the scripted server computes the states
 * from both (see flowScript.ts).
 */
export interface PromiseMeta {
  /** Default: recorded here by Alpine at the note's time. */
  stamp?: Partial<CheckStamp>;
  /** Results before the current check, newest first. */
  older?: { result: FlowCheck['result']; at: string }[];
  /** The user's "맞아요": true for the current wording, or the wording that was confirmed. */
  confirmed?: boolean | string;
  /** The user wrote the confirmed wording in the app (flow/edit). */
  written?: boolean;
  /** Created from a plan document by Alpine. */
  plan?: boolean;
  /** The user's 나중에 보기 / 안 고침; `moved` is true when files changed after the user decided. */
  user?: { state: 'later' | 'wontfix'; reason?: string; at: string; moved?: boolean };
  /** Files the check depends on that changed since it ran. */
  /** The decision above was made on another computer. */
  elsewhere?: boolean;
  changed?: string[];
  replay?: { approved: boolean; running?: boolean; at?: string; same?: boolean; output?: string; current?: boolean };
}

export interface DemoMeta {
  /** Keyed "<nodeId>/<conditionId>". */
  promises: Record<string, PromiseMeta>;
  /** Project files the map points to that no longer exist. */
  missing: string[];
  /** Files changed since the last map sync, as git would list them. */
  files: string[];
  syncedAt: string | null;
  git: boolean;
  include: string[];
  exclude: string[];
  /** map.json `unmapped`: parts the agent knows exist but has not mapped yet. */
  unmapped: UnmappedPart[];
  readOnly: boolean;
  problems: MapProblem[];
  schedule: MapSchedule;
  changes: FlowChange[];
  previews: Record<string, string>;
  /** Keyed "<nodeId>/<conditionId>", aligned with the check's observations. */
  provenance: Record<string, ObservationProvenance[]>;
  /** Keyed "<nodeId>/<conditionId>/<index>". */
  images: Record<string, string>;
  /** Check screenshots keyed "<nodeId>/<conditionId>". */
  shots: Record<string, string>;
}

export const demoMeta = (meta: Partial<DemoMeta> = {}): DemoMeta => ({
  promises: {},
  missing: [],
  files: [],
  syncedAt: null,
  git: true,
  include: [],
  exclude: [],
  unmapped: [],
  readOnly: false,
  problems: [],
  schedule: { enabled: false, limit: 20, lastRun: null },
  changes: [],
  previews: {},
  provenance: {},
  images: {},
  shots: {},
  ...meta,
});

/** Looked up by the map object itself, so `flowScript(STUDIO_MAP)` knows what only the server could know. */
export const DEMO_META = new WeakMap<ProductMap, DemoMeta>();

/*
 * A realistic demo map: a pilates studio booking service with a member app, instructor and admin screens,
 * card payments and messaging integrations. It deliberately mixes every state the map can show.
 */

const promise = (id: string, expectation: string): FlowCondition => ({ id, expectation });
const check = (
  condition: FlowCondition,
  result: FlowCheck['result'],
  command: string,
  output: string,
  files: string[],
  summary = condition.expectation,
): FlowCheck => ({
  conditionId: condition.id,
  expectation: condition.expectation,
  summary,
  command,
  result,
  output,
  dependsOn: files,
});

/*
 * Rich checks carry steps, observations, limits and an environment. The provenance label of each observation is
 * what the real server computes from the session log; here a side table declares it, keyed
 * "<nodeId>/<conditionId>" and aligned with the check's observations.
 */
export const STUDIO_PROVENANCE: Record<string, ObservationProvenance[]> = {};
/** Observation images keyed "<nodeId>/<conditionId>/<index>". */
export const STUDIO_IMAGES: Record<string, string> = {};

const SESSION = 'sess-7c41e2';
type Seed = Observation & { prov: ObservationProvenance; image?: string };
/** The agent read this in a tool call and quoted it exactly. */
const ran = (call: string, label: string, excerpt: string, extra: Partial<Seed> = {}): Seed => ({
  label,
  show: 'text',
  source: { kind: 'tool_call', sessionId: SESSION, ref: call },
  excerpt,
  prov: { label: 'verified', matched: call },
  ...extra,
});
/** A file in the project, still as the agent read it. */
const read = (path: string, label: string, excerpt: string): Seed => ({
  label,
  show: 'diff',
  source: { kind: 'file', sessionId: SESSION, ref: path },
  excerpt,
  prov: { label: 'verified' },
});
/** A screen Alpine captured itself. Without `image` the picture was taken on another computer. */
const shot = (id: string, label: string, image?: string): Seed => ({
  label,
  show: 'image',
  source: { kind: 'surface_capture', sessionId: SESSION, ref: id },
  prov: { label: 'captured' },
  image,
});
/** Only the agent's words. */
const said = (label: string): Seed => ({ label, show: 'text', source: null, prov: { label: 'agent' } });
/** A source was cited but the record does not contain what the agent quoted. */
const unmatched = (call: string, label: string, excerpt: string): Seed => ({
  label,
  show: 'text',
  source: { kind: 'tool_call', sessionId: SESSION, ref: call },
  excerpt,
  prov: { label: 'mismatch', reason: 'excerpt_missing' },
});

const screenImage = (title: string, lines: string[]) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="#f4f4f2"/><rect width="320" height="28" fill="#2b2b2b"/><text x="12" y="19" font-size="13" fill="#fff" font-family="sans-serif">${title}</text>${lines
      .map(
        (line, i) =>
          `<text x="16" y="${58 + i * 28}" font-size="13" fill="#222" font-family="sans-serif">${line}</text>`,
      )
      .join('')}</svg>`,
  )}`;

/** Example screen captures for the demo map, drawn here and marked 예시; some screens are left without one on purpose. */
export const STUDIO_PREVIEWS: Record<string, string> = {
  signup: screenImage('예시 · 카카오로 시작하기', [
    '[ 카카오로 3초 만에 시작 ]',
    '전화번호로 가입',
    '이미 계정이 있어요 → 로그인',
  ]),
  schedule: screenImage('예시 · 이번 주 시간표', [
    '월 07:00 모닝 필라테스  3/8',
    '화 19:30 리포머 기초  마감',
    '수 12:00 점심 요가  5/10',
  ]),
  'class-detail': screenImage('예시 · 리포머 기초', ['강사 김하늘 · 50분 · 정원 8명', '남은 자리 2', '[ 예약하기 ]']),
  cancel: screenImage('예시 · 예약 취소', [
    '수업 24시간 전까지 무료 취소',
    '지금 취소하면 이용권 1회 돌려받아요',
    '[ 취소하기 ]',
  ]),
  'pass-purchase': screenImage('예시 · 이용권 구매', ['1회권 30,000원', '10회권 300,000원', '한 달 무제한 250,000원']),
  roster: screenImage('예시 · 오늘 출석부', ['07:00 모닝 필라테스', '김OO 출석 · 이OO 노쇼', '박OO 대기 → 자리 확정']),
  'admin-schedule': screenImage('예시 · 수업 개설', ['날짜 10월 14일 (화)', '시간 19:30 · 정원 8', '[ 수업 열기 ]']),
};

function rich(
  nodeId: string,
  condition: FlowCondition,
  result: FlowCheck['result'],
  command: string,
  output: string,
  files: string[],
  detail: { summary?: string; steps: string[]; seen: Seed[]; limits?: string[]; environment: string },
): FlowCheck {
  const key = `${nodeId}/${condition.id}`;
  STUDIO_PROVENANCE[key] = detail.seen.map((o) => o.prov);
  detail.seen.forEach((o, index) => {
    if (o.image) STUDIO_IMAGES[`${key}/${index}`] = o.image;
  });
  return {
    ...check(condition, result, command, output, files, detail.summary),
    steps: detail.steps as FlowCheck['steps'],
    observations: detail.seen.map((seed) => {
      const o: Partial<Seed> = { ...seed };
      delete o.prov;
      delete o.image;
      return o as Observation;
    }) as FlowCheck['observations'],
    limits: (detail.limits ?? []) as FlowCheck['limits'],
    environment: detail.environment,
  };
}

// Booking: the core of the product, with a real concurrency bug.
const bookConfirm = promise('confirm', '정원이 남아 있으면 예약이 확정되고 이용권 잔여 횟수가 1 줄어든다.');
const bookDuplicate = promise('duplicate', '같은 수업을 두 번 예약하면 두 번째 요청은 거절된다.');
const bookRace = promise(
  'race',
  '마지막 한 자리에 두 명이 동시에 예약하면 한 명만 확정되고 다른 한 명은 대기로 안내된다.',
);
const bookNoPass = promise('no-pass', '이용권이 없으면 예약 대신 이용권 구매 화면으로 안내한다.');
const bookFiles = ['app/api/bookings/route.ts', 'lib/booking/reserve.ts', 'tests/booking.test.ts'];

const waitJoin = promise('join', '정원이 찬 수업은 대기 신청을 받고 대기 순번을 보여준다.');
const waitPromote = promise('promote', '취소로 빈자리가 생기면 1번 대기자가 30분 안에 자동 확정된다.');
const waitLimit = promise('limit', '대기는 수업당 최대 5명까지 받는다.');
const waitFiles = ['lib/booking/waitlist.ts', 'jobs/promote-waitlist.ts', 'tests/waitlist.test.ts'];

const cancelEarly = promise('early', '수업 24시간 전까지 취소하면 이용권 횟수가 그대로 돌아온다.');
const cancelLate = promise('late', '24시간 이내에 취소하면 이용권 1회가 차감된다.');
const cancelStarted = promise('started', '이미 시작한 수업은 취소 버튼이 보이지 않는다.');
const cancelFiles = ['app/(member)/bookings/[id]/cancel.tsx', 'lib/booking/cancel.ts', 'tests/cancel.test.ts'];

const refundFull = promise('full', '사용하지 않은 이용권을 7일 안에 환불하면 결제 금액 전액을 카드 취소한다.');
const refundPartial = promise(
  'partial',
  '일부 사용한 이용권은 실제 결제한 금액을 기준으로 사용분과 위약금 10%를 빼고 남은 금액만 부분 취소한다.',
);
const refundTwice = promise('twice', '같은 환불 요청이 두 번 와도 카드 취소는 한 번만 한다.');
const refundFiles = ['lib/payments/refund.ts', 'lib/payments/toss.ts', 'tests/refund.test.ts'];

const payApprove = promise('approve', '카드 승인이 끝나면 이용권이 바로 발급된다.');
const payDecline = promise('decline', '한도 초과로 거절되면 이용권은 발급되지 않고 다른 카드를 권한다.');
const payAmount = promise('amount', '화면에 보인 금액과 실제 승인 금액이 다르면 승인하지 않는다.');
const payFiles = ['app/api/payments/confirm/route.ts', 'lib/payments/toss.ts', 'tests/payments.test.ts'];

const hookRecheck = promise('recheck', '결제 알림을 받으면 orderId로 결제를 다시 조회해 확인된 상태만 반영한다.');
const hookFast = promise('fast', '결제 알림에 10초 안에 응답한다.');
const hookIdempotent = promise('idempotent', '같은 결제 이벤트가 두 번 와도 이용권은 한 번만 발급된다.');
const hookOrder = promise('order', '취소 이벤트가 승인 이벤트보다 먼저 와도 최종 상태는 취소다.');
const hookFiles = ['app/api/webhooks/toss/route.ts', 'tests/webhooks.test.ts'];

const seatTaken = promise('taken', '결제 후 그 사이 자리가 찼으면 대기로 넣거나 자동 환불한다.');

const deductCheckin = promise('checkin', '출석 체크하면 이용권이 1회 차감된다.');
const deductNoShow = promise('no-show', '노쇼 처리된 예약도 1회 차감된다.');

const talkSend = promise('send', '알림톡 발송 API가 성공하면 발송 기록이 남는다.');
const talkFallback = promise('fallback', '알림톡이 실패하면 같은 내용을 문자로 보낸다.');

const signupKakao = promise('kakao', '카카오로 처음 로그인하면 회원이 만들어지고 시간표로 이동한다.');
const signupReturning = promise('returning', '이미 가입한 회원은 새로 만들지 않고 기존 계정으로 로그인한다.');

const signupBack = promise('back', '카카오 로그인 뒤 보던 화면으로 돌아간다.');
const phoneCode = promise('code', '인증번호를 맞게 입력하면 휴대폰 번호가 확인된다.');
const phoneExpire = promise('expire', '3분이 지난 인증번호는 거절한다.');
const phoneLimit = promise('limit', '한 번호로 하루 5번 넘게 요청하면 막는다.');

const detailPhoto = promise('photo', '강사 사진이 늦게 불러와져도 화면 내용이 밀리지 않는다.');
const receiptPdf = promise('pdf', '영수증 PDF가 모든 브라우저에서 열린다.');
const instructorCareer = promise('career', '강사의 경력과 자격증이 보인다.');
const instructorClasses = promise('classes', '강사가 맡은 이번 주 수업이 함께 보인다.');
const reportTotals = promise('totals', '지난달 판매와 환불 합계가 결제 내역과 맞는다.');
const scheduleWeek = promise('week', '이번 주 수업이 요일별로 남은 자리와 함께 보인다.');
const scheduleFull = promise('full', '정원이 찬 수업은 대기 신청 버튼으로 바뀐다.');
const detailInfo = promise('info', '수업 시간, 강사, 난이도, 남은 자리가 보인다.');
const passOptions = promise('options', '1회권, 10회권, 한 달 무제한 가격이 보이고 하나를 고를 수 있다.');
const reminderOnce = promise('once', '수업 2시간 전에 예약자에게 알림을 한 번만 보낸다.');
const checkinQr = promise('qr', '회원 QR을 찍으면 그 수업의 출석으로 바뀐다.');
const checkinWrong = promise('wrong', '다른 수업의 QR이면 출석 처리하지 않고 알려준다.');
const rosterList = promise('list', '강사는 오늘 맡은 수업의 예약자와 출석 여부를 본다.');
const promotedNotice = promise('notice', '대기에서 확정되면 회원에게 확정 알림이 간다.');
const adminOpen = promise('open', '관리자가 수업을 열면 회원 시간표에 바로 보인다.');

const STUDIO_BASE: ProductMap = {
  flows: [
    {
      id: 'first-booking',
      title: '첫 수업 예약하기',
      description: '처음 온 회원이 가입하고 수업을 고르면, 이용권이 없어도 결제하고 바로 예약할 수 있어야 한다.',
      trigger: '처음 온 회원이 광고 링크로 앱을 연다',
      nodeIds: [
        'signup',
        'phone-verify',
        'schedule',
        'class-detail',
        'pass-purchase',
        'pay',
        'seat-recheck',
        'book',
        'waitlist',
        'waitlist-notify',
        'reminder',
      ],
    },
    {
      id: 'cancel-refund',
      title: '예약 취소와 환불',
      description: '회원이 예약을 취소하면, 규정에 맞게 이용권이나 결제 금액을 돌려받을 수 있어야 한다.',
      trigger: '회원이 예약 내역에서 취소를 누른다',
      nodeIds: ['cancel', 'pass-deduct', 'refund', 'toss-webhook', 'receipt', 'waitlist', 'waitlist-notify'],
    },
    {
      id: 'class-day',
      title: '수업 당일',
      description: '수업 날이 되면, 회원은 미리 알림을 받고 강사는 출석과 노쇼를 처리할 수 있어야 한다.',
      trigger: '수업 2시간 전, 알림 작업이 돈다',
      nodeIds: ['reminder', 'kakao-alimtalk', 'notify-retry', 'roster', 'checkin', 'no-show', 'pass-deduct'],
    },
    {
      id: 'closure',
      title: '휴강 처리',
      description: '관리자가 수업을 닫으면, 예약자 모두가 환불받고 안내 메시지를 받을 수 있어야 한다.',
      trigger: '관리자가 강사 사정으로 수업을 닫는다',
      nodeIds: ['admin-schedule', 'admin-closure', 'refund', 'kakao-alimtalk', 'receipt'],
    },
    {
      id: 'payment-webhook',
      title: '결제 결과 받기',
      description: '결제 결과가 늦게 오거나 두 번 와도, 이용권과 결제 내역이 정확히 맞아야 한다.',
      trigger: '토스페이먼츠가 결제 결과를 보낸다',
      nodeIds: ['toss-webhook', 'pay', 'refund', 'receipt'],
    },
    {
      id: 'settlement',
      title: '월말 정산',
      description: '대표가 월초에 정산 화면을 열면, 지난달 판매와 환불을 한눈에 확인할 수 있어야 한다.',
      trigger: '대표가 매달 1일에 정산 화면을 연다',
      nodeIds: ['sales-report', 'receipt'],
    },
  ],
  nodes: [
    // 회원·로그인
    {
      id: 'signup',
      title: '카카오로 가입',
      kind: 'screen',
      phase: 'built',
      tags: ['회원·로그인'],
      description: '카카오 계정으로 가입하고 바로 시간표로 들어갑니다.',
      example: '[카카오로 시작하기]\n→ 동의 화면 → 시간표',
      sources: ['app/(auth)/login/page.tsx', 'lib/auth/kakao.ts'],
      conditions: [signupKakao, signupReturning, signupBack],
      checks: [
        rich(
          'signup',
          signupKakao,
          'passed',
          'pnpm e2e auth -- kakao',
          '✓ kakao first login creates member (1.8s)',
          ['lib/auth/kakao.ts'],
          {
            steps: ['테스트 카카오 계정으로 처음 로그인한다', '동의 화면을 지나 도착한 화면을 본다'],
            seen: [
              ran(
                'call_a1',
                '테스트가 회원 한 명을 만들고 시간표 주소로 이동했다고 알려줬어요.',
                '✓ kakao first login creates member and redirects to /schedule (1.8s)',
              ),
              shot('cap_signup_1', '로그인 직후 화면'),
            ],
            limits: ['진짜 카카오 서버가 아니라 테스트 로그인으로 확인했어요.'],
            environment: '로컬 개발 서버 · 카카오 테스트 앱',
          },
        ),
        check(signupReturning, 'passed', 'pnpm test auth -- returning', '1 passed', ['lib/auth/kakao.ts']),
        check(
          signupBack,
          'failed',
          'pnpm e2e auth -- return-to',
          'expected /classes/42, received /schedule',
          ['lib/auth/kakao.ts', 'lib/auth/redirect.ts'],
          '수업 상세에서 로그인',
        ),
        {
          summary: '전체 빌드',
          command: 'pnpm build',
          result: 'passed',
          output: 'Compiled successfully',
        },
      ],
    },
    {
      id: 'phone-verify',
      title: '휴대폰 인증',
      kind: 'process',
      phase: 'built',
      tags: ['회원·로그인'],
      description: '노쇼 연락과 알림톡 발송을 위해 휴대폰 번호를 확인합니다.',
      example: 'POST /auth/phone { phone }\nPOST /auth/phone/verify { code }',
      sources: ['lib/auth/phone.ts'],
      conditions: [phoneCode, phoneExpire, phoneLimit],
      checks: [
        check(phoneCode, 'passed', 'pnpm test phone -- code', '1 passed', ['lib/auth/phone.ts']),
        check(
          phoneLimit,
          'failed',
          'pnpm test phone -- limit',
          'expected 429 on request 6, received 200',
          ['lib/auth/phone.ts'],
          '같은 번호로 6번 요청',
        ),
      ],
    },
    {
      id: 'health-note',
      title: '건강 특이사항',
      kind: 'screen',
      phase: 'built',
      tags: ['회원·로그인'],
      description:
        '허리 디스크, 임신 여부 같은 정보를 강사에게만 보이게 적습니다. 어느 흐름에서 쓰는지 정해지지 않았어요.',
      sources: ['app/(member)/profile/health.tsx'],
    },
    // 수업 탐색
    {
      id: 'schedule',
      title: '주간 시간표',
      kind: 'screen',
      phase: 'built',
      tags: ['수업 탐색'],
      description: '이번 주 수업을 요일별로 보고 남은 자리를 확인합니다.',
      example: '월 10:00 리포머 기초  3/6\n월 19:30 체어 중급  마감 · 대기 2',
      sources: ['app/(member)/schedule/page.tsx'],
      conditions: [scheduleWeek, scheduleFull],
      checks: [
        check(scheduleWeek, 'passed', 'pnpm e2e schedule', '1 passed', ['app/(member)/schedule/page.tsx']),
        rich(
          'schedule',
          scheduleFull,
          'passed',
          'pnpm e2e schedule -- full',
          '1 passed',
          ['app/(member)/schedule/page.tsx'],
          {
            steps: ['정원이 찬 수업이 있는 주의 시간표를 연다', '그 수업 줄의 버튼을 본다'],
            seen: [
              shot(
                'cap_schedule_2',
                '마감된 수업 줄에 [예약] 대신 [대기 신청]이 보여요.',
                screenImage('이번 주 시간표', [
                  '월 10:00 리포머 기초   3/6   [예약]',
                  '월 19:30 체어 중급   마감   [대기 신청]',
                  '화 07:00 매트 입문   1/8   [예약]',
                ]),
              ),
              ran('call_a2', '화면 테스트도 같은 결과로 끝났어요.', '1 passed (schedule full state)'),
            ],
            limits: ['휴대폰 화면 크기에서는 보지 않았어요.'],
            environment: '로컬 개발 서버 · 데스크톱 브라우저',
          },
        ),
      ],
    },
    {
      id: 'class-detail',
      title: '수업 상세',
      kind: 'screen',
      phase: 'built',
      tags: ['수업 탐색'],
      description: '강사, 난이도, 준비물을 보고 예약하거나 이용권을 삽니다.',
      sources: ['app/(member)/classes/[id]/page.tsx'],
      conditions: [detailInfo, detailPhoto],
      checks: [
        check(detailInfo, 'passed', 'pnpm e2e class-detail', '1 passed', ['app/(member)/classes/[id]/page.tsx']),
        check(
          detailPhoto,
          'failed',
          'pnpm e2e class-detail -- slow-photo',
          'layout shift 0.31 (limit 0.1)',
          ['app/(member)/classes/[id]/page.tsx'],
          '사진을 3초 늦게 불러오기',
        ),
      ],
    },
    {
      id: 'instructor-profile',
      title: '강사 소개',
      kind: 'screen',
      phase: 'planned',
      tags: ['수업 탐색'],
      description: '강사 경력과 자격증, 맡은 수업을 보여줄 예정입니다.',
      conditions: [instructorCareer, instructorClasses],
    },
    // 예약·출석
    {
      id: 'book',
      title: '수업 예약',
      kind: 'api',
      phase: 'built',
      tags: ['예약·출석'],
      description: '남은 자리와 이용권을 확인하고 예약을 확정합니다.',
      example: 'POST /api/bookings { classId }\n→ 201 { bookingId, status: "confirmed" }\n→ 409 { reason: "full" }',
      sources: bookFiles,
      conditions: [bookConfirm, bookDuplicate, bookRace, bookNoPass],
      checks: [
        rich('book', bookConfirm, 'passed', 'pnpm test booking -- confirm', '3 passed', bookFiles, {
          steps: ['자리가 남은 수업을 이용권이 있는 회원으로 예약 요청한다', '응답과 이용권 잔여 횟수를 본다'],
          seen: [
            ran(
              'call_b1',
              '예약 요청이 201로 확정됐어요.',
              'POST /api/bookings → 201 { bookingId: "bk_204", status: "confirmed" }',
              { show: 'request' },
            ),
            ran('call_b1', '이용권 잔여 횟수가 10에서 9로 줄었어요.', 'remaining: 10 → 9', {
              expected: '9',
              actual: '9',
            }),
          ],
          environment: '로컬 테스트 DB',
        }),
        check(bookDuplicate, 'passed', 'pnpm test booking -- duplicate', '1 passed', bookFiles),
        rich(
          'book',
          bookRace,
          'failed',
          'pnpm test booking -- race',
          'expected 6 confirmed bookings, received 7\n  at reserve (lib/booking/reserve.ts:42)',
          bookFiles,
          {
            summary: '정원 6명 수업에 동시 요청 2건',
            steps: [
              '정원 6명 수업에 5명을 먼저 예약해 둔다',
              '마지막 한 자리에 두 명이 같은 순간 예약 요청을 보낸다',
              '확정된 예약 수를 센다',
            ],
            seen: [
              ran(
                'call_b2',
                '확정된 예약이 6건이어야 하는데 7건이었어요.',
                'expected 6 confirmed bookings, received 7',
                { expected: '6건', actual: '7건' },
              ),
              said('두 요청이 같은 순간에 남은 자리를 1로 읽은 것으로 보여요. 직접 확인한 원인은 아니에요.'),
            ],
            limits: ['실제 서비스의 여러 서버가 동시에 받는 상황은 시험하지 못했어요.'],
            environment: '로컬 테스트 DB · 요청 2건 동시 실행',
          },
        ),
        check(bookNoPass, 'passed', 'pnpm test booking -- no-pass', '1 passed', bookFiles),
      ],
    },
    {
      id: 'waitlist',
      title: '대기 신청·자동 확정',
      kind: 'process',
      phase: 'built',
      tags: ['예약·출석'],
      description: '정원이 찬 수업에 대기하고, 빈자리가 나면 순서대로 확정합니다.',
      example: '대기 1번 → 취소 발생 → 30분 안에 자동 확정',
      sources: waitFiles,
      conditions: [waitJoin, waitPromote, waitLimit],
      checks: [
        check(waitJoin, 'passed', 'pnpm test waitlist -- join', '1 passed', waitFiles),
        {
          // The promise changed from 1 hour to 30 minutes after this check ran.
          ...rich('waitlist', waitPromote, 'passed', 'pnpm test waitlist -- promote', '1 passed', waitFiles, {
            steps: [
              '정원이 찬 수업에 대기 1번을 둔다',
              '예약자 한 명이 취소한다',
              '대기 1번이 확정되기까지 걸린 시간을 잰다',
            ],
            seen: [
              ran(
                'call_c1',
                '대기 1번이 취소 후 52분 만에 확정됐어요.',
                'promoted waitlist #1 after 52m (limit: 60m)',
                {
                  expected: '60분 이내',
                  actual: '52분',
                },
              ),
            ],
            limits: ['지금 약속인 30분 기준으로는 아직 재보지 않았어요.'],
            environment: '로컬 테스트 DB · 시계를 앞당겨 실행',
          }),
          expectation: '취소로 빈자리가 생기면 1번 대기자가 1시간 안에 자동 확정된다.',
        },
        check(waitLimit, 'passed', 'pnpm test waitlist -- limit', '1 passed', waitFiles),
      ],
    },
    {
      id: 'cancel',
      title: '예약 취소',
      kind: 'screen',
      phase: 'built',
      tags: ['예약·출석'],
      description: '취소 규정을 보여주고 예약을 취소합니다.',
      example: '수업 24시간 전까지 무료 취소\n이후 취소 시 1회 차감\n[예약 취소]',
      sources: cancelFiles,
      conditions: [cancelEarly, cancelLate, cancelStarted],
      checks: [
        rich('cancel', cancelEarly, 'passed', 'pnpm test cancel -- early', '1 passed', cancelFiles, {
          steps: ['수업 하루 전 시점에 예약을 취소한다', '이용권 잔여 횟수를 본다'],
          seen: [
            shot(
              'cap_cancel_3',
              '취소가 끝난 뒤 예약 내역 화면이에요.',
              screenImage('예약 내역', ['리포머 기초 · 월 10:00', '취소됨 · 이용권 1회 돌아옴', '남은 횟수 10회']),
            ),
            ran('call_d1', '취소 후 잔여 횟수가 9회에서 10회로 돌아왔어요.', 'remaining before: 9, after cancel: 10', {
              expected: '10',
              actual: '10',
            }),
          ],
          environment: '로컬 개발 서버 · 시계를 수업 하루 전으로 설정',
        }),
        rich(
          'cancel',
          cancelStarted,
          'blocked',
          'pnpm e2e cancel -- started',
          '테스트 환경에서 현재 시각을 바꿀 수 없어 실행하지 못함',
          cancelFiles,
          {
            steps: ['이미 시작한 수업의 예약 내역을 연다', '취소 버튼이 있는지 본다'],
            seen: [
              ran(
                'call_d2',
                '테스트가 시작한 수업 상태를 만들지 못하고 멈췄어요.',
                'Error: cannot set clock in this environment',
                {
                  show: 'text',
                },
              ),
            ],
            limits: ['시작한 수업의 화면은 한 번도 보지 못했어요.'],
            environment: '로컬 개발 서버',
          },
        ),
      ],
    },
    {
      id: 'checkin',
      title: 'QR 출석',
      kind: 'screen',
      phase: 'built',
      tags: ['예약·출석'],
      description: '스튜디오 태블릿으로 회원 QR을 찍어 출석합니다.',
      sources: ['app/(studio)/checkin/page.tsx'],
      conditions: [checkinQr, checkinWrong],
      checks: [
        check(checkinQr, 'passed', 'pnpm e2e checkin', '1 passed', ['app/(studio)/checkin/page.tsx']),
        check(
          checkinWrong,
          'failed',
          'pnpm e2e checkin -- wrong',
          'expected no attendance change, received attended',
          ['app/(studio)/checkin/page.tsx'],
          '다른 수업의 QR 찍기',
        ),
      ],
    },
    {
      id: 'no-show',
      title: '노쇼 처리',
      kind: 'process',
      phase: 'building',
      tags: ['예약·출석'],
      description: '수업이 끝나도 출석하지 않은 예약을 노쇼로 바꾸고 3회 누적 시 1주 예약을 막습니다.',
      sources: ['jobs/no-show.ts'],
    },
    // 결제·이용권
    {
      id: 'pass-purchase',
      title: '이용권 구매',
      kind: 'screen',
      phase: 'built',
      tags: ['결제·이용권'],
      description: '1회권, 10회권, 한 달 무제한 중 하나를 고릅니다.',
      example: '1회권 35,000원\n10회권 300,000원\n한 달 무제한 390,000원',
      sources: ['app/(member)/passes/page.tsx'],
      conditions: [passOptions],
      checks: [check(passOptions, 'passed', 'pnpm e2e passes', '1 passed', ['app/(member)/passes/page.tsx'])],
    },
    {
      id: 'pay',
      title: '카드 결제 승인',
      kind: 'api',
      phase: 'built',
      tags: ['결제·이용권', '카드 결제'],
      description: '토스페이먼츠 결제창 결과를 확인하고 이용권을 발급합니다.',
      example: 'POST /api/payments/confirm\n{ paymentKey, orderId, amount }\n→ { passId, remaining: 10 }',
      sources: payFiles,
      conditions: [payApprove, payDecline, payAmount],
      checks: [
        rich('pay', payApprove, 'passed', 'pnpm test payments -- approve', '2 passed', payFiles, {
          steps: ['토스 테스트 키로 결제를 승인한다', '발급된 이용권을 본다'],
          seen: [
            ran(
              'call_e1',
              '승인 요청이 성공하고 10회 이용권이 발급됐어요.',
              'POST /api/payments/confirm → 200 { passId: "ps_88", remaining: 10 }',
              { show: 'request' },
            ),
          ],
          limits: ['테스트 결제라 실제 카드사 승인은 확인할 수 없어요.'],
          environment: '로컬 개발 서버 · 토스 테스트 결제',
        }),
        check(payDecline, 'passed', 'pnpm test payments -- decline', '1 passed', payFiles),
        rich('pay', payAmount, 'passed', 'pnpm test payments -- amount', '1 passed', payFiles, {
          steps: ['화면에 보인 금액과 다른 금액으로 승인을 요청한다'],
          seen: [
            said('다른 금액으로 보내니 승인되지 않았다고 해요.'),
            unmatched(
              'call_e2',
              '서버가 400 AMOUNT_MISMATCH로 거절했어요.',
              'POST /api/payments/confirm → 400 AMOUNT_MISMATCH',
            ),
          ],
          environment: '로컬 개발 서버 · 토스 테스트 결제',
        }),
      ],
    },
    {
      id: 'seat-recheck',
      title: '결제 직후 자리 재확인',
      kind: 'process',
      phase: 'built',
      tags: ['결제·이용권', '카드 결제'],
      description: '결제가 끝난 순간 자리가 이미 찼는지 다시 보고, 찼으면 대기로 넣거나 자동으로 환불합니다.',
      example: '결제 완료 → 남은 자리 0\n→ 대기 신청으로 넣기 또는 전액 자동 환불',
      sources: ['lib/booking/after-payment.ts'],
      conditions: [seatTaken],
    },
    {
      id: 'pass-deduct',
      title: '이용권 차감',
      kind: 'process',
      phase: 'built',
      tags: ['결제·이용권'],
      description: '출석, 노쇼, 당일 취소 때 이용권 횟수를 줄입니다.',
      sources: ['lib/passes/deduct.ts'],
      conditions: [deductCheckin, deductNoShow],
      checks: [
        // Lists no files it depends on, so it cannot count as a current pass.
        check(deductCheckin, 'passed', 'pnpm test passes -- checkin', '1 passed', []),
      ],
    },
    {
      id: 'refund',
      title: '이용권 환불',
      kind: 'process',
      phase: 'built',
      tags: ['결제·이용권', '환불'],
      description:
        '실제 결제한 금액을 기준으로 환불 금액을 계산하고 카드 결제를 취소합니다. 사용분과 위약금 계산식은 약관을 확인한 뒤 확정해야 해요.',
      example: '10회권 300,000원, 3회 사용\n→ 사용분 90,000원 + 위약금 30,000원 공제\n→ 180,000원 부분 취소',
      sources: refundFiles,
      conditions: [refundFull, refundPartial, refundTwice],
      checks: [
        rich('refund', refundFull, 'passed', 'pnpm test refund -- full', '1 passed', refundFiles, {
          steps: ['10회권을 결제하고 쓰지 않은 채 환불을 요청한다', '카드 취소 요청의 금액을 본다'],
          seen: [
            ran(
              'call_f1',
              '토스 테스트 취소 요청이 결제 금액 전액이었어요.',
              'POST /v1/payments/{paymentKey}/cancel { cancelAmount: 300000 }\npaidAmount: 300000',
              {
                show: 'request',
                expected: '300,000원',
                actual: '300,000원',
              },
            ),
            read('lib/payments/refund.ts', '전액 환불 분기 코드예요.', 'if (pass.used === 0) return pass.paidAmount;'),
          ],
          limits: ['실제 카드사 취소 반영은 테스트 결제라 확인할 수 없어요.'],
          environment: '로컬 개발 서버 · 토스 테스트 결제',
        }),
        rich(
          'refund',
          refundPartial,
          'failed',
          'pnpm test refund -- partial',
          'expected cancelAmount 180000, received 210000',
          refundFiles,
          {
            summary: '10회권 3회 사용 후 환불',
            steps: ['300,000원 10회권을 결제한다', '수업에 3번 출석한다', '환불을 요청하고 카드 취소 금액을 본다'],
            seen: [
              ran(
                'call_f2',
                '카드 취소 금액이 예상보다 30,000원 많았어요.',
                'expected cancelAmount 180000, received 210000',
                {
                  expected: '180,000원 (사용분 90,000원과 위약금 30,000원을 뺀 금액)',
                  actual: '210,000원',
                },
              ),
              said('위약금 10%가 빠지지 않은 것으로 보여요. 직접 확인한 원인은 아니에요.'),
            ],
            limits: ['약관의 정확한 계산식은 확인하지 못했어요. 기대값은 예시 계산이에요.'],
            environment: '로컬 개발 서버 · 토스 테스트 결제',
          },
        ),
        check(refundTwice, 'passed', 'pnpm test refund -- twice', '1 passed', refundFiles),
      ],
    },
    {
      id: 'receipt',
      title: '결제 내역',
      kind: 'data',
      phase: 'built',
      tags: ['결제·이용권'],
      description: '결제, 환불, 차감 기록을 한곳에 남깁니다.',
      example: '{ type: "refund", amount: -180000, passId, at }',
      sources: ['prisma/schema.prisma'],
      conditions: [receiptPdf],
      checks: [
        check(
          receiptPdf,
          'failed',
          'pnpm e2e receipt -- pdf',
          'iPhone Safari: blank page instead of PDF',
          ['app/(member)/receipts/[id]/pdf.tsx'],
          '아이폰 사파리에서 영수증 열기',
        ),
      ],
    },
    {
      id: 'legacy-coupon',
      title: '오픈 기념 쿠폰',
      kind: 'process',
      phase: 'built',
      description: '오픈 이벤트 때 만든 할인 쿠폰 코드입니다. 지금도 쓰이는지 확인되지 않았어요.',
      sources: ['lib/payments/coupon.ts'],
    },
    // 알림
    {
      id: 'reminder',
      title: '수업 전 알림',
      kind: 'process',
      phase: 'built',
      tags: ['알림'],
      description: '수업 2시간 전에 예약자에게 알림톡을 보냅니다.',
      sources: ['jobs/reminder.ts'],
      conditions: [reminderOnce],
      checks: [check(reminderOnce, 'passed', 'pnpm test jobs -- reminder', '2 passed', ['jobs/reminder.ts'])],
    },
    {
      id: 'waitlist-notify',
      title: '대기 확정 알림',
      kind: 'process',
      phase: 'built',
      tags: ['알림'],
      description: '대기에서 확정된 회원에게 알립니다.',
      sources: ['jobs/promote-waitlist.ts'],
      conditions: [promotedNotice],
    },
    {
      id: 'notify-retry',
      title: '알림 실패 재시도',
      kind: 'process',
      phase: 'built',
      tags: ['알림'],
      description: '알림톡이 실패하면 1분 간격으로 3번 다시 보냅니다.',
      sources: ['jobs/notify-retry.ts'],
    },
    // 강사·관리자
    {
      id: 'roster',
      title: '강사 출석부',
      kind: 'screen',
      phase: 'built',
      tags: ['강사·관리자'],
      description: '강사가 오늘 수업의 예약자와 특이사항을 확인합니다.',
      sources: ['app/(studio)/roster/page.tsx'],
      conditions: [rosterList],
      checks: [check(rosterList, 'passed', 'pnpm e2e roster', '1 passed', ['app/(studio)/roster/page.tsx'])],
    },
    {
      id: 'admin-schedule',
      title: '수업 개설·변경',
      kind: 'screen',
      phase: 'built',
      tags: ['강사·관리자'],
      description: '관리자가 수업을 열고 시간, 강사, 정원을 바꿉니다.',
      sources: ['app/(admin)/classes/page.tsx'],
      conditions: [adminOpen],
      checks: [check(adminOpen, 'passed', 'pnpm e2e admin-classes', '1 passed', ['app/(admin)/classes/page.tsx'])],
    },
    {
      id: 'admin-closure',
      title: '휴강 일괄 처리',
      kind: 'process',
      phase: 'building',
      tags: ['강사·관리자'],
      description: '휴강한 수업의 예약을 모두 취소하고 이용권을 돌려준 뒤 알립니다.',
      sources: ['lib/classes/close.ts'],
    },
    {
      id: 'sales-report',
      title: '월별 매출 정산',
      kind: 'screen',
      phase: 'planned',
      tags: ['강사·관리자'],
      description: '이용권 판매, 환불, 강사별 수업 수를 월 단위로 봅니다.',
      conditions: [reportTotals],
    },
    // 외부 연동
    {
      id: 'toss-webhook',
      title: '결제 결과 받기',
      kind: 'api',
      phase: 'built',
      tags: ['외부 연동'],
      description: '토스페이먼츠가 보내는 결제 상태 알림을 받고, 결제를 다시 조회해 확인된 상태만 반영합니다.',
      example:
        'POST /api/webhooks/toss\n{ eventType: "PAYMENT_STATUS_CHANGED", data: { orderId } }\n→ GET /v1/payments/orders/{orderId}\n→ 200 (10초 안에)',
      sources: hookFiles,
      conditions: [hookRecheck, hookFast, hookIdempotent, hookOrder],
      checks: [
        rich('toss-webhook', hookRecheck, 'passed', 'pnpm test webhooks -- recheck', '2 passed', hookFiles, {
          steps: [
            '결제 상태 변경 알림을 보낸다. 알림 내용은 실제 결제와 다르게 조작한다',
            '서버가 결제를 다시 조회하는지 본다',
            '저장된 결제 상태를 본다',
          ],
          seen: [
            ran(
              'call_g1',
              '서버가 알림 내용을 믿지 않고 orderId로 결제를 다시 조회했어요.',
              'GET /v1/payments/orders/ORD-1042 → 200 { status: "DONE" }',
              { show: 'request' },
            ),
            ran(
              'call_g1',
              '알림에는 CANCELED라고 적혀 있었지만 다시 조회한 DONE만 저장됐어요.',
              'webhook body status: CANCELED\nstored status: DONE',
              {
                expected: 'DONE',
                actual: 'DONE',
              },
            ),
            read(
              'app/api/webhooks/toss/route.ts',
              '알림 처리 코드가 조회 결과를 쓰는 부분이에요.',
              'const payment = await toss.getByOrderId(body.data.orderId);',
            ),
          ],
          limits: ['토스 서버가 실제로 보낸 알림이 아니라 직접 만든 알림으로 시험했어요.'],
          environment: '로컬 개발 서버 · 토스 테스트 결제',
        }),
        rich('toss-webhook', hookIdempotent, 'passed', 'pnpm test webhooks -- idempotent', '1 passed', hookFiles, {
          steps: ['같은 결제 알림을 두 번 보낸다', '발급된 이용권 수를 센다'],
          seen: [said('이용권이 한 장만 발급됐다고 해요.')],
          environment: '로컬 테스트 DB',
        }),
      ],
    },
    {
      id: 'kakao-alimtalk',
      title: '카카오 알림톡 발송',
      kind: 'sdk',
      phase: 'built',
      tags: ['외부 연동'],
      description: '알림톡 발송 서비스로 템플릿 메시지를 보냅니다.',
      example:
        'alimtalk.send({\n  template: "CLASS_REMINDER",\n  to: member.phone,\n  vars: { className, startsAt }\n})',
      sources: ['lib/notify/alimtalk.ts'],
      conditions: [talkSend, talkFallback],
      checks: [
        rich(
          'kakao-alimtalk',
          talkSend,
          'blocked',
          'pnpm test notify -- alimtalk',
          '테스트용 발신 프로필 키가 없어 실제 발송을 확인하지 못함',
          ['lib/notify/alimtalk.ts'],
          {
            steps: ['수업 알림 템플릿으로 알림톡 발송을 요청한다'],
            seen: [ran('call_h1', '발신 프로필 키가 없다는 오류로 멈췄어요.', 'Error: ALIMTALK_SENDER_KEY is not set')],
            limits: ['실제 발송과 발송 기록 저장은 시도하지 못했어요.'],
            environment: '로컬 개발 서버',
          },
        ),
      ],
    },
  ],
  edges: [
    // 첫 수업 예약하기
    { source: 'signup', target: 'phone-verify' },
    { source: 'phone-verify', target: 'schedule' },
    { source: 'schedule', target: 'class-detail' },
    { source: 'class-detail', target: 'book', label: '이용권 있음' },
    { source: 'class-detail', target: 'pass-purchase', label: '이용권 없음' },
    { source: 'pass-purchase', target: 'pay' },
    { source: 'pay', target: 'seat-recheck', label: '결제 완료' },
    { source: 'seat-recheck', target: 'book', label: '자리 있음' },
    { source: 'seat-recheck', target: 'waitlist', label: '자리 없음' },
    { source: 'seat-recheck', target: 'refund', label: '자동 환불' },
    { source: 'book', target: 'waitlist', label: '정원 마감' },
    { source: 'book', target: 'reminder', label: '확정' },
    { source: 'waitlist', target: 'waitlist-notify', label: '빈자리' },
    { source: 'waitlist-notify', target: 'book', label: '자동 확정' },
    // 예약 취소와 환불
    { source: 'cancel', target: 'pass-deduct', label: '24시간 이내' },
    { source: 'cancel', target: 'refund', label: '이용권 환불' },
    { source: 'cancel', target: 'waitlist', label: '빈자리 생김' },
    { source: 'refund', target: 'toss-webhook', label: '카드 취소' },
    { source: 'toss-webhook', target: 'receipt' },
    // 수업 당일
    { source: 'reminder', target: 'kakao-alimtalk' },
    { source: 'kakao-alimtalk', target: 'notify-retry', label: '발송 실패' },
    { source: 'notify-retry', target: 'kakao-alimtalk', label: '재시도' },
    { source: 'roster', target: 'checkin', label: '출석' },
    { source: 'roster', target: 'no-show', label: '미출석' },
    { source: 'checkin', target: 'pass-deduct' },
    { source: 'no-show', target: 'pass-deduct' },
    // 휴강 처리
    { source: 'admin-schedule', target: 'admin-closure', label: '휴강' },
    { source: 'admin-closure', target: 'refund' },
    { source: 'admin-closure', target: 'kakao-alimtalk', label: '예약자 안내' },
    { source: 'refund', target: 'receipt' },
    // 결제 결과 받기
    { source: 'toss-webhook', target: 'pay', label: '승인' },
    { source: 'pay', target: 'receipt' },
    // 월말 정산
    { source: 'sales-report', target: 'receipt' },
  ],
};

/*
 * The user's own calls and the plain-language results, layered over the base map so the structure above stays readable.
 * Priority, scope and decision are the user's decisions; the agent never sets them.
 */
type Meta = Pick<FlowNode, 'priority' | 'scope' | 'decision' | 'previewAt'>;
const NODE_META: Record<string, Meta> = {
  signup: { priority: 'must', scope: 'now' },
  'phone-verify': { priority: 'must', scope: 'now' },
  'health-note': { priority: 'should', scope: 'next', decision: '쓰는 흐름이 정해지면 강사 출석부에만 보이게 연결' },
  schedule: { priority: 'must', scope: 'now' },
  'class-detail': { priority: 'must', scope: 'now' },
  'instructor-profile': { priority: 'later', scope: 'next' },
  book: { priority: 'must', scope: 'now', decision: '정원 초과가 해결되기 전에는 출시하지 않는다' },
  waitlist: { priority: 'should', scope: 'now' },
  cancel: { priority: 'must', scope: 'now' },
  checkin: { priority: 'should', scope: 'now' },
  'no-show': { priority: 'should', scope: 'next' },
  'pass-purchase': { priority: 'must', scope: 'now' },
  pay: { priority: 'must', scope: 'now' },
  'seat-recheck': { priority: 'must', scope: 'now' },
  'pass-deduct': { priority: 'must', scope: 'now' },
  refund: {
    priority: 'must',
    scope: 'now',
    decision: '부분 환불은 실제 결제 금액 기준으로 계산하고 위약금 10%를 뺀다 (약관 문구 확인 전까지 예시 계산)',
  },
  receipt: { priority: 'should', scope: 'now' },
  'legacy-coupon': {
    priority: 'later',
    scope: 'out',
    decision: '오픈 이벤트가 끝나 새로 만들지 않고 정리 후보로 둔다',
  },
  reminder: { priority: 'should', scope: 'now' },
  'waitlist-notify': { priority: 'should', scope: 'next' },
  'notify-retry': { priority: 'later', scope: 'next' },
  roster: { priority: 'should', scope: 'now' },
  'admin-schedule': { priority: 'must', scope: 'now' },
  'admin-closure': {
    priority: 'should',
    scope: 'next',
    decision: '휴강 환불은 자동, 안내 메시지는 관리자가 확인 후 발송',
  },
  'sales-report': { priority: 'later', scope: 'next' },
  'toss-webhook': { priority: 'must', scope: 'now' },
  'kakao-alimtalk': { priority: 'should', scope: 'now' },
};

/** `<nodeId>/<conditionId>` -> when it was checked and what happened, in one sentence. */
const CHECK_NOTES: Record<string, [string, string]> = {
  'signup/kakao': [
    '2026-10-02T02:10:00Z',
    '테스트 카카오 계정으로 처음 로그인하니 회원이 만들어지고 시간표로 이동했어요.',
  ],
  'signup/returning': ['2026-10-02T02:12:00Z', '이미 가입한 카카오 계정으로 다시 로그인해도 회원이 하나만 있어요.'],
  'phone-verify/code': ['2026-10-03T04:40:00Z', '맞는 인증번호로 확인을 요청하자 휴대폰 번호가 확인됨으로 바뀌었어요.'],
  'schedule/week': ['2026-10-09T05:10:00Z', '이번 주 수업이 요일별로 남은 자리와 함께 보였어요.'],
  'schedule/full': ['2026-10-09T05:11:00Z', '정원이 찬 수업에는 예약 대신 대기 신청 버튼이 보였어요.'],
  'class-detail/info': ['2026-10-09T05:13:00Z', '수업 시간, 강사, 난이도, 남은 자리가 모두 보였어요.'],
  'book/confirm': ['2026-10-05T07:00:00Z', '자리가 남은 수업을 예약하니 바로 확정되고 이용권이 1회 줄었어요.'],
  'book/duplicate': ['2026-10-05T07:02:00Z', '같은 수업을 한 번 더 예약하려고 하니 거절됐어요.'],
  'book/race': ['2026-10-11T08:20:00Z', '정원 6명 수업에 두 명이 동시에 예약하자 7명이 확정됐어요.'],
  'book/no-pass': ['2026-10-05T07:05:00Z', '이용권이 없는 회원이 예약하면 이용권 구매 화면으로 안내됐어요.'],
  'waitlist/join': ['2026-10-06T03:00:00Z', '정원이 찬 수업에 대기 신청하니 대기 순번이 보였어요.'],
  'waitlist/promote': [
    '2026-10-03T03:30:00Z',
    '취소로 자리가 나자 1번 대기자가 1시간 안에 확정됐어요. 약속이 30분으로 바뀌어 다시 확인해야 해요.',
  ],
  'waitlist/limit': ['2026-10-06T03:10:00Z', '6번째 대기 신청은 받지 않고 안내했어요.'],
  'cancel/early': ['2026-10-08T01:20:00Z', '수업 하루 전에 취소하니 이용권 횟수가 그대로 돌아왔어요.'],
  'cancel/started': [
    '2026-10-08T01:25:00Z',
    '시간을 바꿀 수 없어 시작한 수업에서 취소 버튼이 없는지는 확인하지 못했어요.',
  ],
  'checkin/qr': ['2026-10-07T10:00:00Z', '회원 QR을 찍으니 그 수업이 출석으로 바뀌었어요.'],
  'checkin/wrong': ['2026-10-07T10:05:00Z', '다른 수업의 QR을 찍어도 출석으로 바뀌었어요.'],
  'signup/back': ['2026-10-05T02:30:00Z', '수업 상세에서 카카오로 로그인하니 보던 수업이 아닌 시간표로 이동했어요.'],
  'phone-verify/limit': ['2026-10-03T04:50:00Z', '같은 번호로 6번째 요청을 보내도 막히지 않고 인증번호가 발송됐어요.'],
  'class-detail/photo': ['2026-10-09T05:15:00Z', '사진을 3초 늦게 불러오자 아래 내용이 밀려 내려갔어요.'],
  'receipt/pdf': ['2026-10-04T06:20:00Z', '아이폰 사파리에서 영수증 PDF 대신 빈 화면이 나왔어요.'],
  'pass-purchase/options': [
    '2026-10-09T05:18:00Z',
    '1회권, 10회권, 한 달 무제한 가격이 보이고 하나를 고를 수 있었어요.',
  ],
  'pay/approve': ['2026-10-04T06:00:00Z', '테스트 키로 결제를 승인하니 이용권이 바로 발급됐어요.'],
  'pay/decline': ['2026-10-04T06:05:00Z', '한도 초과 카드로 결제하니 이용권 없이 다른 카드를 권했어요.'],
  'pay/amount': [
    '2026-10-04T06:08:00Z',
    '금액을 바꿔 보내니 승인하지 않고 막았다고 해요. 서버 응답 기록은 확인되지 않았어요.',
  ],
  'pass-deduct/checkin': [
    '2026-10-07T10:30:00Z',
    '출석 체크 후 이용권이 1회 줄었어요. 코드가 바뀌어 다시 확인이 필요해요.',
  ],
  'refund/full': ['2026-10-10T02:00:00Z', '쓰지 않은 이용권을 환불하니 결제 금액 전액이 취소됐어요.'],
  'refund/partial': [
    '2026-10-10T02:05:00Z',
    '10회권을 3번 쓰고 환불하자 예상한 180,000원이 아닌 210,000원이 취소됐어요.',
  ],
  'refund/twice': ['2026-10-10T02:08:00Z', '같은 환불을 두 번 요청해도 카드 취소는 한 번만 일어났어요.'],
  'reminder/once': ['2026-10-06T09:00:00Z', '알림 작업을 두 번 돌려도 알림 요청은 한 번만 만들어졌어요.'],
  'roster/list': ['2026-10-07T09:50:00Z', '강사 화면에 오늘 수업의 예약자와 출석 여부가 보였어요.'],
  'admin-schedule/open': ['2026-10-08T04:00:00Z', '관리자가 연 수업이 회원 시간표에 바로 나타났어요.'],
  'toss-webhook/recheck': [
    '2026-10-12T01:30:00Z',
    '알림 내용과 다른 결제 상태가 와도 서버가 결제를 다시 조회해 확인된 상태만 저장했어요.',
  ],
  'toss-webhook/idempotent': ['2026-10-12T01:32:00Z', '같은 결제 이벤트를 두 번 보내도 이용권은 한 번만 발급됐어요.'],
  'kakao-alimtalk/send': ['2026-10-11T03:00:00Z', '발신 프로필 키가 없어 실제 알림톡 발송은 확인하지 못했어요.'],
};

const day = (d: string, time = '03:00') => `2026-10-${d}T${time}:00Z`;
const adminPage = 'app/(admin)/classes/page.tsx';
const passesPage = 'app/(member)/passes/page.tsx';
const checkinPage = 'app/(studio)/checkin/page.tsx';

/*
 * What Alpine knows about each promise: who confirmed it, how its results went, which files moved, what the user
 * decided. Promises not listed are the plain case: written by the agent, recorded here, files unchanged.
 */
const PROMISES: Record<string, PromiseMeta> = {
  'signup/kakao': { confirmed: true, elsewhere: true },
  // 나중에 보기, and the login code changed since: it wakes as "고쳐졌을 수도".
  'signup/back': { user: { state: 'later', at: day('06'), moved: true }, changed: ['lib/auth/redirect.ts'] },
  // The agent offered a way to re-run it, the user has not approved it yet.
  'phone-verify/code': { replay: { approved: false } },
  // Recorded on another computer: this one cannot compare it.
  'schedule/week': { stamp: { sessionId: 'sess-5d09aa', witness: 'other' } },
  'schedule/full': { stamp: { sessionId: 'sess-5d09aa', witness: 'other' } },
  // Written outside Alpine: the time is when Alpine first saw it.
  'class-detail/info': { stamp: { at: '2026-10-13T00:40:00Z', sessionId: null, firstSeen: true } },
  'class-detail/photo': { user: { state: 'later', at: day('11', '09:00') } },
  'book/confirm': { confirmed: true, changed: ['lib/booking/reserve.ts'] },
  'book/race': { confirmed: true },
  'waitlist/join': { changed: ['lib/booking/waitlist.ts'] },
  // The user confirmed the 1 hour wording; the agent has since changed it to 30 minutes.
  'waitlist/promote': { confirmed: '취소로 빈자리가 생기면 1번 대기자가 1시간 안에 자동 확정된다.' },
  'cancel/early': { changed: ['lib/booking/cancel.ts'] },
  // Re-running right now, without a model.
  'pass-purchase/options': {
    changed: [passesPage],
    replay: { approved: true, running: true, at: day('12', '09:10'), same: true, output: '1 passed', current: false },
  },
  // A file the check depends on was edited after it ran, so the time cannot be trusted.
  'pay/approve': { stamp: { uncertain: true } },
  // Re-run after the change and the result came out different.
  'pay/decline': {
    changed: ['lib/payments/toss.ts'],
    replay: {
      approved: true,
      at: day('13', '00:20'),
      same: false,
      current: true,
      output: 'FAIL payments decline\n  expected the issued pass count to be 0, received 1',
    },
  },
  'refund/full': { confirmed: true },
  // Fixed on 10/8, broken again on 10/10.
  'refund/partial': {
    confirmed: true,
    older: [
      { result: 'passed', at: day('08', '05:00') },
      { result: 'failed', at: day('06', '05:00') },
    ],
  },
  // Failed on 10/9, a passing check came after.
  'refund/twice': { older: [{ result: 'failed', at: day('09', '04:00') }] },
  'receipt/pdf': {
    confirmed: true,
    elsewhere: true,
    user: { state: 'wontfix', reason: '이메일 영수증으로 충분해요.', at: day('05', '01:00') },
  },
  // Re-run after the change and the result was the same, so the pass stands.
  'reminder/once': {
    changed: ['jobs/reminder.ts'],
    replay: { approved: true, at: day('13', '00:20'), same: true, current: true, output: '2 passed' },
  },
  'checkin/wrong': { confirmed: true, changed: [checkinPage] },
  // The record on this computer no longer matches what Alpine wrote.
  'roster/list': { stamp: { witness: 'mismatch' } },
  'admin-schedule/open': { changed: [adminPage] },
  'toss-webhook/idempotent': { confirmed: true },
  // From a plan document: confirmed by definition.
  'instructor-profile/career': { plan: true },
  'instructor-profile/classes': { plan: true },
  'sales-report/totals': { plan: true },
};

const REPLAYS: Record<string, string[]> = {
  'phone-verify/code': ['1 passed'],
  'reminder/once': ['2 passed'],
  'pay/decline': ['1 passed'],
  'pass-purchase/options': ['1 passed'],
};

const STUDIO_SHOTS: Record<string, string> = {
  'schedule/full': screenImage('이번 주 시간표', [
    '월 10:00 리포머 기초   3/6   [예약]',
    '월 19:30 체어 중급   마감   [대기 신청]',
    '화 07:00 매트 입문   1/8   [예약]',
  ]),
  'cancel/early': screenImage('예약 내역', ['리포머 기초 · 월 10:00', '취소됨 · 이용권 1회 돌아옴', '남은 횟수 10회']),
};

function enrich(map: ProductMap): ProductMap {
  const document = structuredClone(map);
  for (const node of document.nodes ?? []) {
    Object.assign(node, NODE_META[node.id]);
    for (const check of node.checks ?? []) {
      const key = `${node.id}/${check.conditionId}`;
      const [at, plain] = CHECK_NOTES[key] ?? ['2026-10-02T02:20:00Z', '전체 빌드가 문제없이 끝났어요.'];
      check.plain = plain;
      if (!check.conditionId) continue;
      check.id = `chk-${node.id}-${check.conditionId}`;
      if (REPLAYS[key])
        check.replay = {
          command: check.command,
          cwd: '.',
          expect: REPLAYS[key] as NonNullable<FlowCheck['replay']>['expect'],
        };
      if (STUDIO_SHOTS[key]) check.screenshot = `.alpine-code/evidence/${node.id}-${check.conditionId}.png`;
      const meta = (PROMISES[key] ??= {});
      meta.stamp = { at, sessionId: SESSION, witness: 'mine', ...meta.stamp };
    }
    for (const condition of node.conditions ?? []) PROMISES[`${node.id}/${condition.id}`] ??= {};
  }
  return document;
}

export const STUDIO_MAP: ProductMap = enrich(STUDIO_BASE);

/** Recent changes for the demo history, newest first. */
export const STUDIO_CHANGES: FlowChange[] = [
  {
    at: '2026-10-13T00:20:00Z',
    nodeId: 'pay',
    title: '카드 결제 승인',
    kind: 'replay_different',
    detail: '한도 초과로 거절되면 이용권은 발급되지 않고 다른 카드를 권한다.',
  },
  {
    at: '2026-10-13T00:20:00Z',
    nodeId: 'reminder',
    title: '수업 전 알림',
    kind: 'replay_same',
    detail: '수업 2시간 전에 예약자에게 알림을 한 번만 보낸다.',
  },
  {
    at: '2026-10-12T08:00:00Z',
    nodeId: 'book',
    title: '수업 예약',
    kind: 'promise_confirmed',
    detail: '마지막 한 자리에 두 명이 동시에 예약하면 한 명만 확정되고 다른 한 명은 대기로 안내된다.',
  },
  {
    at: '2026-10-12T06:30:00Z',
    nodeId: 'receipt',
    title: '결제 내역',
    kind: 'issue_wontfix',
    detail: '이메일 영수증으로 충분해요.',
  },
  {
    at: '2026-10-12T05:00:00Z',
    nodeId: 'signup',
    title: '카카오로 가입',
    kind: 'issue_reopened',
    detail: '카카오 로그인 뒤 보던 화면으로 돌아간다.',
  },
  {
    at: '2026-10-12T01:00:00Z',
    nodeId: 'toss-webhook',
    title: '결제 결과 받기',
    kind: 'check_passed',
    detail: '같은 결제 이벤트를 두 번 보내도 이용권은 한 번만 발급됐어요.',
  },
  {
    at: '2026-10-11T09:00:00Z',
    nodeId: 'class-detail',
    title: '수업 상세',
    kind: 'issue_later',
    detail: '강사 사진이 늦게 불러와져도 화면 내용이 밀리지 않는다.',
  },
  {
    at: '2026-10-11T08:20:00Z',
    nodeId: 'book',
    title: '수업 예약',
    kind: 'check_failed',
    detail: '정원 6명 수업에 두 명이 동시에 예약하자 7명이 확정됐어요.',
  },
  {
    at: '2026-10-10T02:05:00Z',
    nodeId: 'refund',
    title: '이용권 환불',
    kind: 'check_failed',
    detail: '10회권을 3번 쓰고 환불하자 예상한 180,000원이 아닌 210,000원이 취소됐어요.',
  },
  {
    at: '2026-10-10T01:00:00Z',
    nodeId: 'refund',
    title: '이용권 환불',
    kind: 'exclude_changed',
    detail: 'tests/fixtures/**',
  },
  {
    at: '2026-10-09T06:00:00Z',
    nodeId: 'waitlist',
    title: '대기 신청·자동 확정',
    kind: 'promise_changed',
    detail: '취소로 빈자리가 생기면 1번 대기자가 30분 안에 자동 확정된다.',
  },
  {
    at: '2026-10-08T01:25:00Z',
    nodeId: 'cancel',
    title: '예약 취소',
    kind: 'check_blocked',
    detail: '시간을 바꿀 수 없어 시작한 수업에서 취소 버튼이 없는지는 확인하지 못했어요.',
  },
  { at: '2026-10-06T11:00:00Z', nodeId: 'no-show', title: '노쇼 처리', kind: 'phase', detail: 'planned -> building' },
  { at: '2026-10-04T06:10:00Z', nodeId: 'admin-closure', title: '휴강 일괄 처리', kind: 'added', detail: 'planned' },
];

// This label was recorded on the other computer too.
const elsewhere = STUDIO_PROVENANCE['schedule/full']?.[1];
if (elsewhere) elsewhere.elsewhere = true;

DEMO_META.set(
  STUDIO_MAP,
  demoMeta({
    promises: PROMISES,
    missing: ['lib/payments/coupon.ts'],
    files: [
      // Covered by a card.
      'lib/booking/reserve.ts',
      'lib/booking/cancel.ts',
      'lib/payments/toss.ts',
      'jobs/reminder.ts',
      // Nothing in the map points to these.
      'lib/members/profile.ts',
      'app/(member)/profile/page.tsx',
      'lib/passes/expire.ts',
      'jobs/expire-passes.ts',
      'app/api/passes/route.ts',
      'lib/auth/session.ts',
      'prisma/migrations/20261011_pass_expiry.sql',
      // Outside the folders the user chose.
      'infra/terraform/main.tf',
      'docs/terms.md',
      'scripts/seed.ts',
      // Hidden by the agent's exclude patterns.
      'tests/fixtures/members.json',
      'tests/fixtures/classes.json',
      'tests/fixtures/passes.json',
      'app/__snapshots__/schedule.snap',
      'lib/generated/prisma.d.ts',
    ],
    syncedAt: '2026-10-08T00:00:00Z',
    include: ['app', 'lib', 'jobs', 'prisma', 'tests'],
    exclude: ['pnpm-lock.yaml', 'tests/fixtures/**', 'public/**', '**/*.snap', 'lib/generated/**'],
    unmapped: [
      {
        title: '강사가 자기 수업 출석을 체크하기',
        why: '강사용 화면은 이번에 다 보지 못했어요.',
        paths: ['app/instructor/'],
      },
      {
        title: '운영자가 환불을 승인하거나 거절하기',
        why: '관리자 화면과 환불 규칙이 어떻게 이어지는지 아직 확인하지 못했어요.',
        paths: ['app/admin/refunds/', 'lib/refund/'],
      },
    ],
    changes: STUDIO_CHANGES,
    previews: STUDIO_PREVIEWS,
    provenance: STUDIO_PROVENANCE,
    images: STUDIO_IMAGES,
    shots: STUDIO_SHOTS,
  }),
);

/** A map written by a newer Alpine, with two files this version could not read: it opens read-only. */
export const READ_ONLY_MAP: ProductMap = {
  flows: [
    {
      id: 'new-env',
      title: '새 환경 만들기',
      description: '새 환경을 만들면 네트워크가 먼저 준비되고, 서버가 그 안에서 뜰 수 있어야 한다.',
      trigger: '운영자가 새 환경을 요청한다',
      nodeIds: ['vpc', 'peering'],
    },
  ],
  nodes: [
    {
      id: 'vpc',
      title: '네트워크 구성',
      kind: 'process',
      phase: 'built',
      tags: ['네트워크'],
      description: '환경마다 분리된 네트워크와 서브넷을 만듭니다.',
      sources: ['modules/vpc/main.tf'],
      conditions: [{ id: 'subnets', expectation: '환경마다 서로 겹치지 않는 서브넷이 만들어진다.' }],
      checks: [
        {
          id: 'chk-vpc-subnets',
          conditionId: 'subnets',
          expectation: '환경마다 서로 겹치지 않는 서브넷이 만들어진다.',
          summary: 'terraform plan으로 서브넷 범위 비교',
          command: 'terraform plan -var-file=dev.tfvars',
          result: 'passed',
          output: 'Plan: 6 to add, 0 to change, 0 to destroy.',
          dependsOn: ['modules/vpc/main.tf'],
        },
      ],
    },
    {
      id: 'peering',
      title: '환경 간 연결',
      kind: 'process',
      phase: 'planned',
      tags: ['네트워크'],
      description: '개발 환경과 공용 도구 네트워크를 연결할 예정입니다.',
    },
  ],
  edges: [{ source: 'vpc', target: 'peering' }],
};
DEMO_META.set(
  READ_ONLY_MAP,
  demoMeta({
    readOnly: true,
    git: false,
    problems: [
      {
        file: '.alpine-code/map/features/dns.json',
        message: 'kind: Input should be screen, api, sdk, process or data',
      },
      { file: '.alpine-code/map/flows/rollback.json', message: 'nodeIds: expected a list' },
    ],
  }),
);
