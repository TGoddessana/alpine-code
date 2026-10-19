import { defineMessages } from '@/shared/i18n';

/** A finding's sentence by its `code`; a code with none shows the server's `fallback`. */
type Params = Record<string, string>;
type Sentence = (params: Params) => string;

/** The kind of key, when the server named it: ` (Stripe secret key)`. */
const named = (params: Params) => (params.kind ? ` (${params.kind})` : '');

const PUBLIC_KO = '올리면 누구나 볼 수 있어서 올릴 수 없어요.';
const PUBLIC_EN = 'Anyone could read it once it is online, so it cannot be published.';

const KO_CHECKOK: Record<string, string> = {
  secret: '비밀 열쇠가 화면 코드에 없어요',
  'open-api': '로그인해야 볼 수 있는 곳은 모두 잠겨 있어요',
  advisor: '데이터베이스 보안 점검에 걸린 것이 없어요',
};

const KO_CHECKRUNNING: Record<string, string> = {
  secret: '화면 코드에 비밀 열쇠가 있는지 보는 중',
  'open-api': '로그인 없이 열리는 곳이 있는지 보는 중',
  advisor: '데이터베이스 보안을 점검하는 중',
};

const KO_CHECKSKIPPED: Record<string, string> = {
  secret: '만든 화면 코드가 없어서 비밀 열쇠는 보지 못했어요',
  'open-api': '개발 서버가 꺼져 있어서 로그인 없이 열리는 곳은 보지 못했어요',
  advisor: '데이터베이스 보안은 점검하지 않았어요',
};

const KO_FINDING: Record<string, Sentence> = {
  'secret.stripe_live': (p) => `결제 비밀 열쇠가 화면 코드에 들어 있어요${named(p)}. ${PUBLIC_KO}`,
  'secret.openai': (p) => `OpenAI 비밀 열쇠가 화면 코드에 들어 있어요${named(p)}. ${PUBLIC_KO}`,
  'secret.anthropic': (p) => `Anthropic 비밀 열쇠가 화면 코드에 들어 있어요${named(p)}. ${PUBLIC_KO}`,
  'secret.aws': (p) => `AWS 비밀 열쇠가 화면 코드에 들어 있어요${named(p)}. ${PUBLIC_KO}`,
  'secret.private_key': () => `개인 키가 화면 코드에 들어 있어요. ${PUBLIC_KO}`,
  'secret.github': (p) => `GitHub 비밀 열쇠가 화면 코드에 들어 있어요${named(p)}. ${PUBLIC_KO}`,
  'secret.supabase_service': () =>
    `데이터베이스의 관리자 열쇠가 화면 코드에 들어 있어요. 올리면 누구나 모든 데이터를 볼 수 있어서 올릴 수 없어요.`,
  'secret.resend': (p) => `메일 보내기 열쇠가 화면 코드에 들어 있어요${named(p)}. ${PUBLIC_KO}`,
  'secret.alpine_app': () => `이 앱의 Alpine 열쇠가 화면 코드에 들어 있어요. ${PUBLIC_KO}`,
  'secret.google_api': () => 'Google API 열쇠가 화면 코드에 있어요. 지도처럼 공개해도 되는 열쇠라면 괜찮아요.',
  'secret.stripe_test': () =>
    '결제 테스트 열쇠가 화면 코드에 있어요. 실제 돈이 오가지는 않지만 올리기 전에 지우는 게 좋아요.',
  'open_api.readable': (p) => `${p.method ?? ''} ${p.path ?? ''}는 로그인하지 않아도 데이터를 보여줘요.`.trim(),
  'open_api.writable': (p) => `${p.method ?? ''} ${p.path ?? ''}는 로그인하지 않아도 데이터를 바꿀 수 있어요.`.trim(),
};

const KO_FAILURE: Record<string, string> = {
  unreachable: 'Alpine에 연결할 수 없어요. 인터넷을 확인하고 다시 해 보세요.',
  offline: 'Alpine에 연결할 수 없어요. 인터넷을 확인하고 다시 해 보세요.',
  limit_reached: '무료로 쓸 수 있는 만큼을 다 썼어요.',
  payment_required: '이 기능은 Pro에서 쓸 수 있어요.',
  suspended: '이 계정은 지금 멈춰 있어요.',
  taken_down: '이 앱은 내려가 있어서 올릴 수 없어요.',
  rate_limited: '잠깐 너무 자주 눌렀어요. 조금 있다가 다시 해 보세요.',
  update_required: 'Alpine 앱을 새 버전으로 바꿔야 올릴 수 있어요.',
  conflict: '다른 올리기가 아직 끝나지 않았어요. 잠시 뒤에 다시 해 보세요.',
  needs_confirm: '그 사이 확인할 변경이 바뀌었어요. 다시 해 보세요.',
  blocked: '그 사이 막히는 것이 생겼어요. 다시 해 보세요.',
  not_found: '이 프로젝트에 연결된 앱을 찾지 못했어요.',
};

const KO_PURPOSE: Record<string, string> = {
  web: '사람들이 이 주소로 앱을 열 수 있게 해요',
  spf: '내 도메인으로 보낸 메일이 스팸으로 가지 않게 해요 (SPF)',
  dkim: '메일이 정말 이 앱에서 왔다는 서명이에요 (DKIM)',
  dmarc: '가짜 메일을 걸러내는 규칙이에요 (DMARC)',
};

const EN_PURPOSE: Record<string, string> = {
  web: 'Lets people open the app at this address',
  spf: 'Keeps mail from your domain out of spam (SPF)',
  dkim: 'A signature that the mail really came from this app (DKIM)',
  dmarc: 'A rule that filters out fake mail (DMARC)',
};

const KO_REASON: Record<string, string> = {
  publish: '올린 때',
  data_write: 'AI가 데이터를 바꾸기 전',
  before_restore: '되돌리기 전',
  manual: '직접 만든 지점',
};

const EN_CHECKOK: Record<string, string> = {
  secret: 'No secret keys in the page code',
  'open-api': 'Everything that needs sign-in is locked',
  advisor: 'The database security check found nothing',
};

const EN_CHECKRUNNING: Record<string, string> = {
  secret: 'Looking for secret keys in the page code',
  'open-api': 'Looking for places that open without sign-in',
  advisor: 'Checking the database security',
};

const EN_CHECKSKIPPED: Record<string, string> = {
  secret: 'There is no built page code, so secret keys were not checked',
  'open-api': 'The dev server is off, so places that open without sign-in were not checked',
  advisor: 'The database security was not checked',
};

const EN_FINDING: Record<string, Sentence> = {
  'secret.stripe_live': (p) => `A payment secret key is in the page code${named(p)}. ${PUBLIC_EN}`,
  'secret.openai': (p) => `An OpenAI secret key is in the page code${named(p)}. ${PUBLIC_EN}`,
  'secret.anthropic': (p) => `An Anthropic secret key is in the page code${named(p)}. ${PUBLIC_EN}`,
  'secret.aws': (p) => `An AWS secret key is in the page code${named(p)}. ${PUBLIC_EN}`,
  'secret.private_key': () => `A private key is in the page code. ${PUBLIC_EN}`,
  'secret.github': (p) => `A GitHub secret key is in the page code${named(p)}. ${PUBLIC_EN}`,
  'secret.supabase_service': () =>
    'The database admin key is in the page code. Anyone could read all the data once it is online, so it cannot be published.',
  'secret.resend': (p) => `A mail-sending key is in the page code${named(p)}. ${PUBLIC_EN}`,
  'secret.alpine_app': () => `This app’s Alpine key is in the page code. ${PUBLIC_EN}`,
  'secret.google_api': () =>
    'A Google API key is in the page code. That is fine if it is meant to be public, like a maps key.',
  'secret.stripe_test': () =>
    'A payment test key is in the page code. No real money moves, but it is better removed before publishing.',
  'open_api.readable': (p) => `${p.method ?? ''} ${p.path ?? ''} shows data to people who are not signed in.`.trim(),
  'open_api.writable': (p) => `${p.method ?? ''} ${p.path ?? ''} lets people who are not signed in change data.`.trim(),
};

const EN_FAILURE: Record<string, string> = {
  unreachable: 'Cannot reach Alpine. Check the internet and try again.',
  offline: 'Cannot reach Alpine. Check the internet and try again.',
  limit_reached: 'You have used all the free plan allows.',
  payment_required: 'This needs Pro.',
  suspended: 'This account is paused right now.',
  taken_down: 'This app has been taken down, so it cannot be published.',
  rate_limited: 'Too many tries in a short time. Try again in a moment.',
  update_required: 'Update the Alpine app to publish.',
  conflict: 'Another publish has not finished yet. Try again in a moment.',
  needs_confirm: 'The changes to confirm changed meanwhile. Try again.',
  blocked: 'Something started blocking meanwhile. Try again.',
  not_found: 'No app is connected to this project.',
};

const EN_REASON: Record<string, string> = {
  publish: 'When it was published',
  data_write: 'Before the AI changed data',
  before_restore: 'Before going back',
  manual: 'Made by hand',
};

export const messages = defineMessages({
  ko: {
    publish: '올리기',
    unpublished: '아직 안 올린 변경이 있어요',
    changes: (count: number) => `바뀐 것 ${count}개`,
    lastPublished: (when: string) => `마지막으로 올린 때 · ${when}`,
    firstTime: '처음 올려요',
    aiChecked: 'AI가 확인한 것',
    aiCheckedCount: (passed: number, total: number) => `약속 ${total}개 중 ${passed}개를 직접 확인했어요`,
    aiCheckedNothing: '아직 AI가 직접 확인한 기록이 없어요',
    evidence: '근거 보기',
    security: '보안 검사',
    dataShape: '데이터 구조',
    checking: '검사하는 중',
    ok: '괜찮아요',
    attention: '확인 필요',
    blocked: '막혀요',
    skipped: '건너뛰었어요',
    fixWithAi: 'AI에게 고쳐 달라고 하기',
    fixSending: '보내는 중',
    fixFailed: 'AI에게 보내지 못했어요. 다시 눌러 주세요.',
    // The message the AI gets. It is plain text in the person's language; `fix` lines are English on purpose.
    fixMessage: (lines: string) => `올리기 전 검사에서 걸린 것이 있어요. 고쳐 주세요.\n\n${lines}`,
    buildFixMessage: (tail: string) => `올리려고 앱을 만들다가 실패했어요. 원인을 찾아 고쳐 주세요.\n\n${tail}`,
    checkOk: (key: string) => (Object.hasOwn(KO_CHECKOK, key) ? KO_CHECKOK[key]! : ''),
    checkRunning: (key: string) => (Object.hasOwn(KO_CHECKRUNNING, key) ? KO_CHECKRUNNING[key]! : ''),
    checkSkipped: (key: string) => (Object.hasOwn(KO_CHECKSKIPPED, key) ? KO_CHECKSKIPPED[key]! : ''),
    checkOther: (id: string) => `${id} 검사`,
    findingAt: (file: string, line: number | null) => (line ? `${file} ${line}번째 줄` : file),
    finding: (code: string, params: Params) => (Object.hasOwn(KO_FINDING, code) ? KO_FINDING[code]!(params) : ''),
    findingUnknown: '확인이 필요한 것이 있어요',
    addedTables: (names: string) => `표가 생겨요 · ${names}`,
    addedColumns: (names: string) => `칸이 생겨요 · ${names}`,
    noDataChange: '데이터 구조는 그대로예요',
    restoreFirst: '올리기 전에 되돌리기 지점을 만들어요',
    confirmDropColumn: (table: string, column: string) =>
      `"${table}" 표의 "${column}" 칸이 지워져요. 그 칸에 있던 내용은 되돌리기 지점으로만 살릴 수 있어요.`,
    confirmDropTable: (table: string) =>
      `"${table}" 표가 통째로 지워져요. 안에 있던 내용은 되돌리기 지점으로만 살릴 수 있어요.`,
    confirmRename: (table: string, column: string | null) =>
      column
        ? `"${table}" 표의 "${column}" 칸 이름이 바뀌어요. 이름이 바뀌면 기존 내용이 이어지지 않을 수 있어요.`
        : `"${table}" 표 이름이 바뀌어요. 이름이 바뀌면 기존 내용이 이어지지 않을 수 있어요.`,
    confirmDataChange: (table: string | null) =>
      table ? `"${table}" 표의 내용이 바뀌어요.` : '데이터의 내용이 바뀌어요.',
    confirmUnknown: '무엇을 바꾸는지 알 수 없는 변경이 있어요. 올리기 전에 한 번 확인해 주세요.',
    confirmOther: '확인이 필요한 변경이 있어요.',
    confirmRows: (count: number) => `지금 ${count}행이 들어 있어요`,
    confirmOk: '괜찮아요',
    confirmsLeft: (count: number) => `확인할 변경 ${count}개가 남았어요`,
    publishing: '올리는 중이에요',
    prepareBuild: '앱을 만드는 중',
    prepareChecks: '검사하는 중',
    prepareUpload: '올릴 파일을 보내는 중',
    prepareOther: '준비하는 중',
    stepRestore: '되돌리기 지점 만드는 중',
    stepFiles: '파일 올리는 중',
    stepShape: '데이터 구조 바꾸는 중',
    stepLive: '켜는 중',
    stepOther: '올리는 중',
    stop: '그만두기',
    published: '올렸어요',
    publishedLead: '폰 카메라로 찍으면 바로 열려요. 친구에게 주소를 보내 보세요.',
    copy: '주소 복사',
    copied: '복사했어요',
    open: '열기',
    again: '다시 해 보기',
    buildFailedTitle: '앱을 만들다가 멈췄어요',
    buildFailedLead: '아래 마지막 줄들에 이유가 있어요. AI가 읽고 고칠 수 있어요.',
    prepareFailedTitle: '올릴 준비를 하다가 멈췄어요',
    runFailedTitle: '올리다가 멈췄어요',
    runFailedLead: '이전 버전이 그대로 떠 있어요. 데이터도 올리기 전으로 돌아갔어요.',
    failure: (key: string) => (Object.hasOwn(KO_FAILURE, key) ? KO_FAILURE[key]! : ''),
    failureOther: '올리지 못했어요.',
    detail: '자세히',
    signInReason: '인터넷에 올리려면 Alpine 계정이 필요해요. 무료예요.',
    needNodeTitle: '올리려면 Node.js가 필요해요',
    needNodeLead: '앱을 만들 때 쓰는 프로그램이에요. Alpine이 직접 받아 둘 수 있어요.',
    needNodeInstall: 'Node.js 받기',
    cannot: '이 프로젝트는 아직 인터넷에 올릴 수 없어요.',
    restorePoints: '되돌리기',
    restoreTitle: '되돌리기 지점',
    restoreLead:
      '고르면 데이터와 코드가 그 때로 함께 돌아가요. 지금 상태도 지점으로 남겨 두니까 다시 돌아올 수 있어요.',
    restoreWindow: (days: number) => `최근 ${days}일 안의 지점만 보여요`,
    restoreEmpty: '아직 되돌리기 지점이 없어요. 올리거나 AI가 데이터를 바꾸면 생겨요.',
    restoreBack: '올리기로',
    restoreDo: '이 때로 되돌리기',
    restoring: '되돌리는 중이에요',
    restored: (when: string) => `되돌렸어요. 데이터와 코드가 함께 돌아왔어요 (${when}).`,
    restoreFailed: '되돌리지 못했어요. 아무것도 바뀌지 않았어요.',
    close: '닫기',
    reason: (key: string) => (Object.hasOwn(KO_REASON, key) ? KO_REASON[key]! : ''),
    reasonOther: '되돌리기 지점',
    domainsLink: '도메인·배지',
    domainsTitle: '내 도메인과 배지',
    domainsBack: '돌아가기',
    domainsSection: '내 도메인',
    domainsLead: '가지고 있는 도메인을 앱 주소로 쓸 수 있어요. 도메인을 파는 곳에서 아래 값을 넣어야 해요.',
    domainsProOnly: '내 도메인은 Pro에서 쓸 수 있어요.',
    seePro: 'Pro 알아보기',
    domainsNeedApp: '먼저 앱을 한 번 올려야 도메인을 이을 수 있어요.',
    domainInput: '도메인',
    domainPlaceholder: 'booking.example.com',
    domainMail: '이 도메인으로 메일도 보내기 (가입 확인 메일 같은 것)',
    domainAdd: '추가',
    domainInvalid: '도메인 주소가 올바르지 않아요. booking.example.com처럼 써 주세요.',
    domainTaken: '이미 쓰고 있는 도메인이에요.',
    domainFailed: '도메인을 추가하지 못했어요. 잠시 뒤에 다시 해 보세요.',
    domainNone: '아직 이은 도메인이 없어요.',
    domainStatus: (status: string) =>
      status === 'active'
        ? '연결됐어요'
        : status === 'pending'
          ? '확인 중이에요'
          : status === 'failed'
            ? '연결하지 못했어요'
            : status,
    domainRecordsLead:
      '도메인을 사 둔 곳의 DNS 설정에 아래 줄을 그대로 넣어 주세요. 반영되는 데 몇 분에서 몇 시간 걸려요.',
    recordPurpose: (key: string) => (Object.hasOwn(KO_PURPOSE, key) ? KO_PURPOSE[key]! : '연결에 필요한 값이에요'),
    recordCopy: '값 복사',
    domainConnect: (provider: string) => `${provider}에서 한 번에 연결`,
    domainAskAi: 'AI에게 연결 도와 달라고 하기',
    domainAskMessage: (domain: string, lines: string) =>
      `내 도메인 ${domain}을 이 앱에 연결하고 싶어요. 도메인을 사 둔 곳의 DNS 설정에 아래 값을 넣는 방법을 단계별로 알려 주세요.\n\n${lines}`,
    domainCheck: '지금 확인하기',
    domainChecking: '확인하는 중',
    domainStillWaiting: '아직 반영되지 않았어요. 조금 있다가 다시 확인해 주세요.',
    domainRemove: '연결 끊기',
    domainRemoveAsk: '이 도메인을 끊을까요? 앱은 원래 주소로 계속 열려요.',
    domainRemoveYes: '끊기',
    domainRemoveNo: '그대로 두기',
    badgeSection: 'Alpine 배지',
    badgeLabel: '앱 화면 구석에 Alpine 배지 보이기',
    badgeFree: '무료 플랜에서는 배지가 항상 보여요. Pro에서 끌 수 있어요.',
    badgeFailed: '배지를 바꾸지 못했어요. 잠시 뒤에 다시 해 보세요.',
    restoreUpgrade: (days: number) => `Pro에서는 최근 ${days}일까지 되돌릴 수 있어요`,
    offer: '다 만들었어요. 직접 써 보고 확인한 것을 모아 뒀어요.',
    offerAsk: '인터넷에 올릴까요?',
    offerEvidence: (count: number) => `근거 ${count}개 보기`,
    later: '나중에',
  },
  en: {
    publish: 'Publish',
    unpublished: 'There are changes not published yet',
    changes: (count: number) => `${count} changes`,
    lastPublished: (when: string) => `Last published · ${when}`,
    firstTime: 'First time online',
    aiChecked: 'What the AI checked',
    aiCheckedCount: (passed: number, total: number) => `Checked ${passed} of ${total} promises by trying them`,
    aiCheckedNothing: 'The AI has not tried anything out yet',
    evidence: 'See evidence',
    security: 'Security checks',
    dataShape: 'Data structure',
    checking: 'Checking',
    ok: 'Fine',
    attention: 'Needs a look',
    blocked: 'Blocked',
    skipped: 'Skipped',
    fixWithAi: 'Ask the AI to fix it',
    fixSending: 'Sending',
    fixFailed: 'Could not send it to the AI. Press again.',
    fixMessage: (lines: string) => `The checks before publishing found something. Please fix it.\n\n${lines}`,
    buildFixMessage: (tail: string) => `Building the app to publish it failed. Find the cause and fix it.\n\n${tail}`,
    checkOk: (key: string) => (Object.hasOwn(EN_CHECKOK, key) ? EN_CHECKOK[key]! : ''),
    checkRunning: (key: string) => (Object.hasOwn(EN_CHECKRUNNING, key) ? EN_CHECKRUNNING[key]! : ''),
    checkSkipped: (key: string) => (Object.hasOwn(EN_CHECKSKIPPED, key) ? EN_CHECKSKIPPED[key]! : ''),
    checkOther: (id: string) => `${id} check`,
    findingAt: (file: string, line: number | null) => (line ? `${file}, line ${line}` : file),
    finding: (code: string, params: Params) => (Object.hasOwn(EN_FINDING, code) ? EN_FINDING[code]!(params) : ''),
    findingUnknown: 'Something needs a look',
    addedTables: (names: string) => `New tables · ${names}`,
    addedColumns: (names: string) => `New columns · ${names}`,
    noDataChange: 'The data structure stays as it is',
    restoreFirst: 'A restore point is made before publishing',
    confirmDropColumn: (table: string, column: string) =>
      `The "${column}" column of the "${table}" table is removed. What it held can only come back from a restore point.`,
    confirmDropTable: (table: string) =>
      `The whole "${table}" table is removed. What it held can only come back from a restore point.`,
    confirmRename: (table: string, column: string | null) =>
      column
        ? `The "${column}" column of the "${table}" table is renamed. What it held may not carry over under the new name.`
        : `The "${table}" table is renamed. What it held may not carry over under the new name.`,
    confirmDataChange: (table: string | null) =>
      table ? `The contents of the "${table}" table change.` : 'The contents of the data change.',
    confirmUnknown: "There's a change we can't read. Please take a look before publishing.",
    confirmOther: 'A change needs your OK.',
    confirmRows: (count: number) => `${count} rows in it now`,
    confirmOk: 'OK',
    confirmsLeft: (count: number) => `${count} changes left to confirm`,
    publishing: 'Publishing',
    prepareBuild: 'Building the app',
    prepareChecks: 'Checking',
    prepareUpload: 'Sending the files',
    prepareOther: 'Getting ready',
    stepRestore: 'Making a restore point',
    stepFiles: 'Uploading files',
    stepShape: 'Changing the data structure',
    stepLive: 'Turning it on',
    stepOther: 'Publishing',
    stop: 'Stop',
    published: 'Published',
    publishedLead: 'Point a phone camera at it to open it. Send the address to a friend.',
    copy: 'Copy address',
    copied: 'Copied',
    open: 'Open',
    again: 'Try again',
    buildFailedTitle: 'Building the app stopped',
    buildFailedLead: 'The last lines below say why. The AI can read them and fix it.',
    prepareFailedTitle: 'Getting ready to publish stopped',
    runFailedTitle: 'Publishing stopped',
    runFailedLead: 'The previous version is still online. The data went back to how it was before publishing.',
    failure: (key: string) => (Object.hasOwn(EN_FAILURE, key) ? EN_FAILURE[key]! : ''),
    failureOther: 'Could not publish.',
    detail: 'Details',
    signInReason: 'Publishing needs an Alpine account. It is free.',
    needNodeTitle: 'Publishing needs Node.js',
    needNodeLead: 'It is the program that builds the app. Alpine can get its own copy.',
    needNodeInstall: 'Get Node.js',
    cannot: 'This project cannot be put online yet.',
    restorePoints: 'Restore',
    restoreTitle: 'Restore points',
    restoreLead:
      'Pick one and the data and the code go back to then, together. The current state is kept as a point too, so you can come back.',
    restoreWindow: (days: number) => `Only points from the last ${days} days are shown`,
    restoreEmpty: 'No restore points yet. They appear when you publish or the AI changes data.',
    restoreBack: 'Back to publishing',
    restoreDo: 'Go back to this point',
    restoring: 'Going back',
    restored: (when: string) => `Done. The data and the code went back together (${when}).`,
    restoreFailed: 'Could not go back. Nothing changed.',
    close: 'Close',
    reason: (key: string) => (Object.hasOwn(EN_REASON, key) ? EN_REASON[key]! : ''),
    reasonOther: 'Restore point',
    domainsLink: 'Domains and badge',
    domainsTitle: 'Your domain and the badge',
    domainsBack: 'Back',
    domainsSection: 'Your domain',
    domainsLead: 'Use a domain you own as the app address. You add the values below where you bought the domain.',
    domainsProOnly: 'Your own domain is part of Pro.',
    seePro: 'See Pro',
    domainsNeedApp: 'Publish the app once before connecting a domain.',
    domainInput: 'Domain',
    domainPlaceholder: 'booking.example.com',
    domainMail: 'Send mail from this domain too (like sign-up confirmations)',
    domainAdd: 'Add',
    domainInvalid: 'That is not a valid domain. Write it like booking.example.com.',
    domainTaken: 'This domain is already in use.',
    domainFailed: "Couldn't add the domain. Try again in a moment.",
    domainNone: 'No domain connected yet.',
    domainStatus: (status: string) =>
      status === 'active'
        ? 'Connected'
        : status === 'pending'
          ? 'Checking'
          : status === 'failed'
            ? "Couldn't connect"
            : status,
    domainRecordsLead:
      'Add these lines to the DNS settings where you bought the domain, exactly as they are. It takes a few minutes to a few hours to take effect.',
    recordPurpose: (key: string) => (Object.hasOwn(EN_PURPOSE, key) ? EN_PURPOSE[key]! : 'Needed to connect it'),
    recordCopy: 'Copy value',
    domainConnect: (provider: string) => `Connect in one click with ${provider}`,
    domainAskAi: 'Ask the AI to help me connect it',
    domainAskMessage: (domain: string, lines: string) =>
      `I want to connect my domain ${domain} to this app. Tell me step by step how to add these values in the DNS settings where I bought the domain.\n\n${lines}`,
    domainCheck: 'Check now',
    domainChecking: 'Checking',
    domainStillWaiting: 'Not in effect yet. Check again in a little while.',
    domainRemove: 'Disconnect',
    domainRemoveAsk: 'Disconnect this domain? The app keeps opening at its original address.',
    domainRemoveYes: 'Disconnect',
    domainRemoveNo: 'Keep it',
    badgeSection: 'Alpine badge',
    badgeLabel: 'Show the Alpine badge in the corner of the app',
    badgeFree: 'On the free plan the badge is always shown. Pro can turn it off.',
    badgeFailed: "Couldn't change the badge. Try again in a moment.",
    restoreUpgrade: (days: number) => `Pro goes back up to ${days} days`,
    offer: 'It is done. I tried it out and gathered what I checked.',
    offerAsk: 'Put it on the internet?',
    offerEvidence: (count: number) => `See ${count} pieces of evidence`,
    later: 'Later',
  },
});
