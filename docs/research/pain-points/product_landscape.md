# 네이티브/데스크톱 AI 코딩 에이전트 앱 제품 지형 (lazycodex.ai, OpenAI Codex 앱, Claude Code 데스크톱/웹)

조사 기준일: 2026-09-28. 각 항목에 출처 날짜를 가능한 한 표기함. 기능 변화가 매우 빠르므로 2026년 상반기 이전 정보는 "(구 정보)"로 표시.

## 1. lazycodex.ai 는 정확히 무엇인가? 누가 만들고, 무엇을 하며, 차별화 포인트와 UX는?

### Takeaway
lazycodex.ai는 **데스크톱 앱이 아니다**. OpenAI Codex(CLI/앱) 위에 얹는 오픈소스(MIT) "에이전트 하네스" 플러그인으로, code-yeongyu의 oh-my-openagent(OmO)를 Codex용으로 가볍게 포장한 배포판이다("LazyVim for lazy.nvim, but for Codex"). 핵심 피치는 "에이전트가 '끝났다'고 말하는 것을 믿지 말고, 증거로 검증된 완료까지 루프를 돌린다"는 것이며, UX는 GUI가 아니라 `$ulw-plan`, `$start-work`, `$ulw-loop` 같은 슬래시형 명령 워크플로이다.

### Cited Findings
- 사이트 자체 소개: "Codex agent harness", "A light port of OmO's Hephaestus, for Codex". 태그라인: "goals not recipes, parallel exploration, verified completion", "Plan, execute, verify, and keep the evidence attached", "For when good enough isn't", "Ultrawork, live". 제작자 code-yeongyu, MIT — [lazycodex.ai](https://lazycodex.ai/)
- GitHub 설명: "The one and only agent harness for complex codebases. Project memory, planning, execution, and verified completion inside Codex." 독립 데스크톱 앱이 아니라 Codex 플러그인으로 배포. 설치는 `npx lazycodex-ai install`(전역 설치 불필요), 실험적 Codex marketplace 설치, 진단은 `npx lazycodex-ai doctor` — [GitHub code-yeongyu/lazycodex](https://github.com/code-yeongyu/lazycodex)
- 대체 설치: `npx --yes --package oh-my-openagent omo install --platform=codex` — [lazycodex.ai](https://lazycodex.ai/)
- 이름은 LazyVim에서 착안 — [검색 요약(GitHub README 기반)](https://github.com/code-yeongyu/lazycodex/blob/main/README.md)
- 관리 주체: README에 "Jobdori, an AI assistant for Sisyphus Labs"가 유지보수한다고 표기 — [GitHub](https://github.com/code-yeongyu/lazycodex); [sisyphuslabs.ai](https://sisyphuslabs.ai)
- GitHub 스타 수: 사이트 표기 1.9k — [lazycodex.ai](https://lazycodex.ai/); 조회 시점 GitHub 페이지에서는 3.7k stars / 232 forks / 150 commits — [GitHub](https://github.com/code-yeongyu/lazycodex) (수치 불일치: 사이트 표기가 오래된 값일 가능성)
- 핵심 명령:
  - `$init-deep`: 계층적 AGENTS.md(프로젝트 메모리)를 생성, 복잡한 디렉터리를 점수화해 코드 근처에 로컬 가이드를 둠
  - `$ulw-plan`: 구현 전 결정이 필요한 작업에 대해 "decision-complete" 계획을 `plans/<slug>.md`에 작성(제품 코드는 건드리지 않음). Prometheus 전략 플래너
  - `$start-work`: 계획 체크리스트를 durable progress(Boulder 상태, `.omo/boulder.json`)와 strict TDD로 실행, 계획 완료 시에만 멈춤
  - `$ulw-loop`: 검증된 완료까지 자기참조 루프(ultrawork 모드 500회, 일반 100회 상한)
  - `$ulw-research`: 코드베이스·웹·공식 문서·OSS 레포에 병렬 explorer/librarian "스웜" — [lazycodex.ai](https://lazycodex.ai/); [Easton Dev, 2026-07-28](https://eastondev.com/blog/en/posts/ai/20260728-lazycodex-codex-agent-harness/)
- 프롬프트에 "ulw"를 넣으면 Ultrawork 오케스트레이션 모드 발동 — [lazycodex.ai](https://lazycodex.ai/)
- 에이전트 역할: Sisyphus(오케스트레이터)가 Hephaestus(deep worker), Oracle, Librarian을 지휘; 서브에이전트 explorer, librarian, plan, momus, metis, codex-ultrawork-reviewer — [GitHub](https://github.com/code-yeongyu/lazycodex)
- Hephaestus 5단계: Explore → Plan → Implement(surgical edits) → Verify(LSP 진단, 테스트) → Manually QA(실제 화면 테스트) — [lazycodex.ai](https://lazycodex.ai/)
- Team Mode: 이름 붙은 Codex 스레드 팀, 리더 1명이 디스크 기반 durable 상태 유지 — [lazycodex.ai](https://lazycodex.ai/)
- 내장 스킬: ulw-research, review-work, remove-ai-slops, frontend(-ui-ux), programming, visual-qa, LSP, AST-grep, comment-checker 등 + pre/post hooks — [lazycodex.ai](https://lazycodex.ai/); [GitHub](https://github.com/code-yeongyu/lazycodex)
- 모델 라우팅으로 쿼터 절약: 강한 모델은 필요할 때만, 일상 작업엔 저렴한 모델 — "benchmark-driven routing, not random model churn" — [GitHub](https://github.com/code-yeongyu/lazycodex)
- 제3자 평가 장점: 계획과 실행 분리(실행 전 승인), 세션 간 유지되는 계층적 컨텍스트, 5개 evidence gate(계획 재독, 자동 검증, 수동 QA, 적대적 체크, 정리), 대형 레포·다파일 변경에 유용 — [Easton Dev, 2026-07-28](https://eastondev.com/blog/en/posts/ai/20260728-lazycodex-codex-agent-harness/)
- 제3자 평가 단점: 설정 오버헤드(hooks, 상태 파일, MCP 서버), 계층 컨텍스트 파일 유지 부담, 단일 파일 수정/일회성 스크립트엔 과함, 풀 오케스트레이션은 OmO Ultimate(유료/상위판) 영역, "완료"를 주장해도 여전히 수동 확인 필요 — [Easton Dev](https://eastondev.com/blog/en/posts/ai/20260728-lazycodex-codex-agent-harness/)
- 가격: 사이트/README에 가격 정보 없음, MIT 오픈소스 — [lazycodex.ai](https://lazycodex.ai/)

### Inferences
- lazycodex는 "앱" 경쟁자라기보다 Codex 앱/CLI의 **워크플로 레이어**다. 데스크톱 앱 디자이너에게 주는 교훈은 UI가 아니라 개념: (1) plan 문서를 1급 산출물로 파일에 남기기, (2) "완료"를 증거(테스트/LSP/스크린샷)로 게이팅, (3) 세션을 넘는 durable 진행 상태, (4) 비용 인식 모델 라우팅. 이는 주류 앱의 "에이전트가 끝났다고 했는데 실제론 안 됨" 고통점에 대한 커뮤니티 해법으로 읽힌다.
- 인기 이유(추정): oh-my-opencode/OmO 계보의 기존 팬층, 한 줄 npx 설치, Codex 구독 쿼터를 그대로 쓰는 무료 도구라는 점. (직접적인 인기 원인 분석 자료는 찾지 못함.)
- code-yeongyu는 oh-my-opencode로 알려진 한국인 개발자로 알고 있으나 이번 조사에서 출처로 확인하지 못함 — 보고서에 쓸 경우 확인 필요.

### Gaps
- 공식 출시일/버전 이력(SourceForge 미러에 v4.15.0 README가 있으나 날짜 미확인), 사용자 반응(HN/Reddit/X) 자료를 찾지 못함.
- OmO Ultimate/Sisyphus Labs의 유료 가격 체계 미확인.
- 스크린샷 등 구체 UI 자료 없음(텍스트 명령 기반).

## 2. OpenAI Codex 데스크톱 앱의 핵심 기능·UX 선택은? Codex CLI/Cloud와의 관계는? 사용자는 무엇을 칭찬하나?

### Takeaway
Codex 앱(2026-02-02 macOS 출시, 2026-03 Windows)은 "에이전트 커맨드 센터"로, 프로젝트별 스레드 + 기본 활성화된 git worktree로 여러 에이전트를 병렬 운용하고, 스레드 안 diff 패인에서 인라인 코멘트·청크 단위 stage/revert·커밋·푸시·PR까지 처리한다. 2026-07-09 ChatGPT 데스크톱 "슈퍼앱"에 흡수되어 Chat/Work/Codex 3모드 중 하나가 되었다. 사용자는 병렬성·worktree·Automations·여백 많은 정돈된 UI를 칭찬한다.

### Cited Findings
**타임라인**
- Codex CLI 2025-04-16(오픈소스), Codex Cloud 2025-05-16(codex-1), 데스크톱 앱 2026-02(macOS), Windows 2026-03, 2026-07-09 ChatGPT 데스크톱에 통합 — [Wikipedia: Codex (AI agent)](https://en.wikipedia.org/wiki/Codex_(AI_agent))
- 앱 출시일 2026-02-02, 초기 macOS 전용 — [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents)
- 사용 규모: 데스크톱 출시 전 월 100만+ 개발자, 2026-03 기준 주간 활성 200만+ — [Wikipedia](https://en.wikipedia.org/wiki/Codex_(AI_agent)); [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents)
- 2026-07-09: ChatGPT 앱, Codex, ChatGPT Atlas를 하나의 데스크톱 "superapp"으로 결합. Chat / ChatGPT Work / Codex 3개 표면, Free 포함 모든 플랜. Codex는 종료가 아니라 전용 코딩 경험으로 유지 — [Coursiv 등 검색 요약](https://coursiv.io/blog/codex-merged-with-chatgpt-app); [TechTimes 2026-07-10](https://www.techtimes.com/articles/320087/20260710/chatgpt-work-free-every-plan-what-openais-codex-merger-changes-you.htm); [Developers Digest](https://www.developersdigest.tech/blog/chatgpt-work-codex-desktop-app)
- 통합 후에도 유지: 레포 인식, 인라인 diff 편집, 사이드 패널 PR 리뷰, 로컬/클라우드 환경, 한 프로젝트 내 다중 레포 — [Developers Digest](https://www.developersdigest.tech/blog/chatgpt-work-codex-desktop-app)
- 공식 문서가 developers.openai.com/codex → learn.chatgpt.com으로 리다이렉트(308). 문서 목차: Projects and chats, Sites, Build plugins, Scheduled tasks, Long-running work, Notifications, "Pets", "Codex Micro", browser, computer use, voice, appshots, Code review, integrated terminal, Local environments(worktrees), Cloud environment, 모드 선택 local/worktree/cloud — [learn.chatgpt.com/docs/features](https://learn.chatgpt.com/docs/features)

**UX 패러다임**
- 에이전트는 프로젝트별로 정리된 별도 스레드에서 실행, 컨텍스트 잃지 않고 전환. 스레드 안에서 변경 리뷰, diff에 코멘트, 에디터에서 열어 수동 수정 — [OpenAI 출시글(검색 요약)](https://openai.com/index/introducing-the-codex-app/)
- worktree 내장: 여러 에이전트가 같은 레포를 충돌 없이 작업, 각자 격리된 복사본. 이후 업데이트로 worktree 기본 활성화, 상태별 태스크 필터, 에이전트 커맨드 센터에서 worktree 세션 생성 — [OpenAI 검색 요약](https://openai.com/index/introducing-the-codex-app/); [Releasebot 2026-09](https://releasebot.io/updates/openai/codex)
- Git 컨트롤: 로컬 프로젝트/worktree 옆에 diff 패인 — 인라인 코멘트로 Codex에 수정 요청, 청크/파일 단위 stage·revert, commit, push, PR 생성까지 앱 안에서 — [developers.openai.com/codex/app/worktrees 검색 요약](https://developers.openai.com/codex/app/worktrees)
- Skills(Figma→코드, Cloudflare/Netlify/Render/Vercel 배포, 이미지 생성, PDF/스프레드시트/docx), OpenAI 내부에 "수백 개" 스킬 — [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents)
- Automations: 지시문+스킬+트리거를 스케줄 실행, 결과는 **리뷰 큐**에 쌓여 개발자 승인 대기(이슈 트리아지, CI 실패 요약, 릴리스 브리프). "skills on a cronjob" — [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents); [Latent Space AINews](https://www.latent.space/p/ainews-openai-codex-app-death-of)
- 내장 브라우저(라이브 웹 미리보기), 파일 트리·터미널 퀵 토글, 세션에서 변경된 모든 파일을 보여주는 사이드 패널 — [검색 요약(XDA/Composio 등 비교글)](https://theaicareerlab.com/blog/claude-desktop-vs-codex-app)
- 사이드바: 상단에 New chat, search, plugins, automations → 그 아래 프로젝트/채팅; 프로젝트별 보기와 시간순 목록 토글. 플러그인 설치 2클릭. 우측 도구는 브라우저식 탭, "Open with"로 Cursor/Zed/Finder/Terminal에서 열기 — [Catalin's Tech, 2026-06-12](https://catalins.tech/codex-vs-claude-code-desktop-apps/)

**샌드박스/승인**
- 샌드박스 모드: read-only / workspace-write / danger-full-access. 승인 정책: on-request / never / granular(untrusted는 deprecated → 프로젝트 trust_level로 이동). 네트워크 기본 off. macOS Seatbelt(`sandbox-exec`), Linux bwrap+seccomp, Windows 자체 샌드박스. `approvals_reviewer = "auto_review"`로 승인 요청을 리뷰어 에이전트가 먼저 판정(데이터 유출·자격증명 탐색·파괴적 작업은 자동 거부) — [codex-docs.com 미러(공식 문서 사본으로 보임)](https://www.codex-docs.com/en/docs/agent-approvals-security); 원문 [developers.openai.com agent-approvals-security](https://developers.openai.com/codex/agent-approvals-security)
- 앱 권한 메뉴: "Ask for approval", "Approve for me"(적격 요청 자동 승인), "Full access", 이름 있는/커스텀 권한 프로필 — [검색 요약(공식 sandboxing 문서)](https://developers.openai.com/codex/concepts/sandboxing)
- Windows용 샌드박스를 별도 구축(엔지니어링 블로그) — [OpenAI](https://openai.com/index/building-codex-windows-sandbox/)
- 버그 사례: worktree 자식 스레드가 Full Access를 상속하지 않고 on-request로 떨어짐 — [openai/codex Issue #40125](https://github.com/openai/codex/issues/40125)
- Codex Cloud: 셋업 단계는 네트워크 허용, 에이전트 단계는 기본 오프라인인 2단계 런타임 — [codex-docs.com](https://www.codex-docs.com/en/docs/agent-approvals-security)
- 주의: IntuitionLabs는 "Never allow / Ask each time / Only on failure / Always allow" 4단계라고 서술하나 공식 문서 용어와 불일치 — [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents) (신뢰도 낮음)

**가격 (시점별)**
- (출시 시점, 2026-02) Free/Go는 체험 기간 한정 접근, Plus/Pro/Business/Edu/Enterprise 포함, 유료 플랜 레이트리밋 2배 프로모션 — [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents)
- (2026-07-09 이후) 모든 플랜에서 앱 사용 가능. Free/Go는 GPT-5.6 Terra, Plus 이상은 Sol/Terra/Luna 선택 + effort 조절, "ultra" effort는 Pro/Enterprise. API 가격 Sol $5/$30, Terra $2.50/$15, Luna $1/$6 (per 1M tokens) — [Developers Digest](https://www.developersdigest.tech/blog/chatgpt-work-codex-desktop-app)

**사용자 칭찬/비판**
- 5–10개 에이전트 병렬 실행, 개발자 역할이 author→conductor로 전환; Automations가 "가장 과소평가된" 기능; "터미널로 돌아가면 과거로 가는 느낌"; @gdb "agent-native interface", @sama 호평, @skirano "Cursor + Claude Code를 대체" — [Latent Space AINews (2026-02)](https://www.latent.space/p/ainews-openai-codex-app-death-of)
- "Cursor는 'IDE에 초능력', Codex 앱은 '레포에 관제실'" — [IntuitionLabs 인용 Dev.to](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents)
- Conductor, CodexMonitor가 같은 "AI Agent Command Center" 패턴을 먼저 선보였다는 지적 — [Latent Space](https://www.latent.space/p/ainews-openai-codex-app-death-of)
- 여백이 넉넉해 덜 답답하고 "사람이 디자인한 것 같아 더 프로페셔널" — [Catalin's Tech, 2026-06-12](https://catalins.tech/codex-vs-claude-code-desktop-apps/)
- 백엔드/로직·지시 이행은 Codex가 우수하나 프론트엔드 디자인이 "bland"해서 Claude Code로 돌아감 — [XDA, 2026-07-16](https://www.xda-developers.com/codex-technically-better-than-claude-code-stopped-using-it-for-one-specific-reason/)
- (구 정보, 2025-05 Codex cloud 시절) "결과까지 불확정 시간 대기가 UX상 아쉽지만 비동기라 여러 태스크 동시 실행은 도움" — [HN](https://news.ycombinator.com/item?id=44042070)

### Inferences
- Codex 앱은 "IDE가 아닌 오케스트레이션 표면"이라는 포지셔닝(Latent Space 제목: "death of the VSCode fork")으로, 코드 편집은 외부 에디터("Open with")에 넘기고 앱은 스레드·diff·git·자동화에 집중.
- ChatGPT 슈퍼앱 통합은 코딩 에이전트를 비개발자(Work)와 같은 셸로 끌어들이는 방향 — 전문 개발자에게는 복잡도 증가 리스크.
- Automations의 "리뷰 큐" 개념은 백그라운드 결과를 인박스처럼 처리하는 UX 패턴으로 차용 가치가 큼.

### Gaps
- OpenAI 공식 출시글(openai.com)은 403으로 직접 열람 실패 — 검색 스니펫과 2차 자료에 의존.
- 공식 문서 이전(learn.chatgpt.com) 후 worktrees 문서 페이지 404 — worktree 핸드오프(local↔worktree) 세부 UX 미확인.
- 온보딩 흐름, 사용량/비용 표시 UI(레이트리밋 게이지 등) 구체 정보를 찾지 못함.
- r/codex 등 Reddit 원문 스레드 직접 확인 못함.

## 3. Claude 데스크톱 앱의 Claude Code 통합 / Claude Code 데스크톱과 웹(claude.ai/code)의 핵심 기능·UX는? 사용자는 무엇을 칭찬하나?

### Takeaway
Claude 데스크톱 앱은 Chat / Cowork / Code 3탭 구조이며, Code 탭은 2026-04-14 재설계로 멀티세션 사이드바(세션별 자동 worktree), 드래그 앤 드롭 패인(Chat·Diff·Browser·Terminal·File·Plan·Tasks·Subagent·iOS Simulator), 로컬/클라우드/SSH/WSL 환경 선택, 5단계 권한 모드, PR·CI 모니터링(자동 수정/자동 머지)까지 갖춘 "IDE급 에이전트 작업공간"이 되었다. 웹(claude.ai/code) 클라우드 세션은 2026-09-23 GA. CLI와 설정·세션을 공유(`/resume`, `/desktop`, `--teleport`)하는 것이 핵심 차별점.

### Cited Findings
**재설계/출시**
- 2026-04-14 재설계: 멀티세션 사이드바(세션별 격리 worktree), 드래그 앤 드롭 워크스페이스(터미널·파일 에디터·diff·프리뷰), 통합 터미널/에디터, 클라우드 Routines. Claude Desktop v1.2581.0+, Pro/Max/Team/Enterprise — [Build Fast with AI](https://blog.buildfastwithai.com/claude-code-desktop-redesign-2026)
- Routines: 프롬프트+레포+커넥터 저장 구성, 트리거는 스케줄(시간/일/주)·API(HTTP POST)·GitHub 이벤트. 리서치 프리뷰, 플랜별 일일 상한 — [Build Fast with AI](https://blog.buildfastwithai.com/claude-code-desktop-redesign-2026)
- 클라우드 세션 GA(2026-09-23): Pro/Max/Team + 자격 있는 Enterprise. 노트북 닫아도 계속 실행, `claude --cloud`로 시작 / `claude --teleport`로 로컬 인계, CI·리뷰 코멘트 감시 후 PR 자동 수정, 브라우저·모바일·데스크톱·터미널 어디서나. 별도 컴퓨트 요금 없이 계정 레이트리밋 공유, 1회 크레딧 Pro $100 / Max $250 — [AICoder 2026-09-23](https://aicoder.com/news/news-20260923-claude-code-cloud-sessions-ga); [검색 요약](https://pasqualepillitteri.it/en/news/17933/claude-code-cloud-sessions-credit-250-dollars)
- 웹 세션은 레포가 클론된 격리 VM, 사전 구성 환경, 기본 제한된 네트워크 — [검색 요약(web-quickstart)](https://code.claude.com/docs/en/web-quickstart)

**세션/병렬성 (공식 문서)** — 이하 전부 [Claude Code Docs: Desktop](https://code.claude.com/docs/en/desktop)
- 새 세션 Cmd+N, 세션 순환 Ctrl+Tab, Cmd/Ctrl 클릭으로 두 세션 **split view**, 상태·프로젝트·환경별 필터/그룹, PR 머지/종료 시 자동 아카이브 옵션.
- worktree: 브랜치 이름 옆 worktree 옵션, 기본 `.claude/worktrees/`, 브랜치 prefix 설정, `.worktreeinclude`로 `.env` 등 gitignored 파일 복사, 세션 hover → 아카이브로 제거.
- 환경 드롭다운: Local(셸 프로필 PATH 상속, 암호화 환경변수), Cloud(앱 닫아도 지속, 다중 레포 추가, 권한은 Accept edits/Plan/Auto만), SSH(첫 연결 시 원격에 Claude Code 자동 설치, 관리자 `sshHostAllowlist`), WSL.
- Tasks 패인: 백그라운드 서브에이전트·셸 명령·워크플로 표시/중지. 사이드바에서 다른 세션 작업 가시화.
- 교차 세션 메시징: "어느 세션이 auth를 건드렸지?" 같은 자연어 질의, 최근 20개 세션 읽기, 수신 세션의 권한 설정 적용, `crossSessionInbound` 거부 설정. Claude가 가치 있는 후속 작업을 **task chip**으로 제안 → 새 worktree 세션으로 분기.
- Side chat(Cmd+; 또는 `/btw`): 메인 스레드 컨텍스트를 읽지만 메인에 기록 안 함.
- Continue in: 로컬 브랜치 push → 요약 생성 → 클라우드 세션 생성, 또는 IDE에서 열기. CLI `/resume`로 CLI 세션을 데스크톱에서 이어가기, CLI에서 `/desktop`으로 데스크톱으로 이동.
- Dispatch 세션(Pro/Max): 폰에서 요청, 완료/승인 필요 시 푸시 알림.

**권한/승인** — [Claude Code Docs: Desktop](https://code.claude.com/docs/en/desktop)
- 전송 버튼 옆 모드 선택(Cmd+Shift+M): Manual(편집·명령 전 질문, diff 표시) / Accept edits(파일 편집·mkdir/touch/mv 자동) / Plan(편집 없이 계획) / Auto(백그라운드 안전 분류기로 검사하며 실행, 관리자 비활성화 가능) / Bypass permissions(Pro/Max는 설정 토글 필요, 클라우드/WSL 불가).
- 브라우저 외부 사이트 첫 조작 시 권한 카드: Allow once / Always allow / Deny, 사이트별 저장. 구매·계정 생성·CAPTCHA는 사용자 입력 없이는 안 함. 로컬 dev 서버는 승인 불필요.
- Computer use 앱 권한 3단계: View only(브라우저·트레이딩) / Click only(터미널·IDE) / Full control.
- 기업 관리: `disableAutoMode`, `disableBypassPermissionsMode`, `disableDesktopLocalSessions`, `managedMcpServers`, MDM(Jamf/Kandji, Windows 레지스트리).

**Diff/리뷰/Git/PR** — [Claude Code Docs: Desktop](https://code.claude.com/docs/en/desktop)
- diff 통계 칩(`+12 -1`) 클릭 또는 Cmd+Shift+D → 좌측 파일 목록 + 우측 변경. 아무 줄이나 클릭해 코멘트 여러 개 작성 후 Cmd+Enter로 **일괄 제출**.
- "Review code" 버튼: Claude가 diff에 코멘트(컴파일 오류·로직 오류·보안 취약점·명백한 버그 등 high-signal만).
- PR 생성 후 CI 상태 바, "Auto-fix"(CI 실패 자동 수정) 토글, "Auto-merge"(체크 통과 시 squash 머지) 토글, CI 완료 데스크톱 알림. `gh` 필요.

**프리뷰/검증**
- Browser 패인(Cmd+Shift+B), 요소 선택(Cmd+Shift+S), 깨끗한 별도 프로필. `.claude/launch.json`으로 dev 서버 구성, `autoVerify` 기본 on → 편집마다 스크린샷·DOM 검사·클릭으로 자가 검증, `autoPort`로 포트 충돌 처리. macOS iOS Simulator 패인 — [Claude Code Docs: Desktop](https://code.claude.com/docs/en/desktop)

**사용량/비용 가시성**
- 모델 선택기 옆 "usage ring": 현재 세션 컨텍스트 사용량 + 모든 Claude Code 표면이 공유하는 기간별 플랜 사용량, 실시간 갱신 — [Claude Code Docs: Desktop](https://code.claude.com/docs/en/desktop)

**트랜스크립트 밀도 조절**
- View mode(Ctrl+O): Normal(툴 호출 요약 접힘) / Thinking / Verbose(모든 툴 호출·파일 읽기) — [Claude Code Docs: Desktop](https://code.claude.com/docs/en/desktop)

**설정 공유**
- `~/.claude/settings.json`, `.mcp.json`, `~/.claude/skills/` 등 CLI와 공유, claude_desktop_config.json의 MCP도 로컬 Code 세션에 로드 — [Claude Code Docs: Desktop](https://code.claude.com/docs/en/desktop)

**사용자 평가**
- Claude 데스크톱은 Chat/Cowork/Code 3탭 번들 — "Claude 중심이면 한 곳에서 전부"; Codex는 병렬 스레드 감독에 최적 — [The AI Career Lab](https://theaicareerlab.com/blog/claude-desktop-vs-codex-app)
- 비판: "busy and crowded", 탭별로 기능이 분산(projects, artifacts, dispatch)되어 선택지 과다, 스킬 설치 5클릭(Codex 2클릭), "AI가 만든 듯한" 외관; 반면 우측 도구의 drawer식 스택은 "somewhat better organized" — [Catalin's Tech, 2026-06-12](https://catalins.tech/codex-vs-claude-code-desktop-apps/)
- 프론트엔드 glitch 존재, ChatGPT 데스크톱만큼 매끄럽지 않다는 평 — [검색 요약](https://theaicareerlab.com/blog/claude-desktop-vs-codex-app)
- 강점: 맥락 이해, 프론트엔드 디자인 품질("modern, personality") — [XDA, 2026-07-16](https://www.xda-developers.com/codex-technically-better-than-claude-code-stopped-using-it-for-one-specific-reason/)
- 한 2차 블로그는 "Copilot이나 Codex는 세션별 worktree 격리 네이티브 데스크톱을 제공하지 않는다"고 주장했으나 이는 Codex 앱의 worktree 기능과 **모순** — [검색 요약(ccleaks 등)](https://ccleaks.com/news/claude-code-desktop-redesign) vs [OpenAI](https://openai.com/index/introducing-the-codex-app/) (해당 주장은 신뢰하지 말 것)

### Inferences
- Claude Code 데스크톱의 방향은 "터미널 에이전트를 GUI로 감싼 것"에서 "브라우저·시뮬레이터·터미널·파일 편집까지 품은 에이전트용 IDE"로 이동. 기능 밀도는 가장 높지만 그 대가로 "복잡하고 붐빈다"는 평을 받음 — 경쟁 앱이 공략할 수 있는 지점.
- CLI↔데스크톱↔웹↔모바일 간 세션 이동(`/desktop`, `/resume`, `--teleport`, Continue in)이 Anthropic 생태계의 락인 포인트.
- 자가 검증(autoVerify)·CI auto-fix·"Review code" 등은 lazycodex가 하네스로 해결하려는 "검증된 완료" 문제를 제품 차원에서 흡수하는 흐름.

### Gaps
- Claude 플랜 가격(Pro/Max 월 요금)은 이번 조사에서 1차 출처로 확인하지 못함(학습 지식상 Pro $20, Max $100/$200이나 2026-09 현재 확인 필요).
- 온보딩 흐름(첫 실행, 레포 연결, GitHub App 설치 등) 구체 UX 미확인.
- Reddit r/ClaudeAI 원문 반응 직접 확인 못함.

## 4. 병렬성·샌드박스·권한·diff·리뷰/머지·git·세션 기록·비용 가시성에서 어떻게 다른가?

### Takeaway
Codex 앱과 Claude Code 데스크톱은 병렬성(스레드/세션 + worktree), diff 인라인 코멘트, 앱 내 git/PR에서 거의 수렴했다. 차이는 샌드박스 철학(Codex = OS 수준 샌드박스 + 승인 정책의 2축, Claude = 권한 모드 + 안전 분류기 중심)과 작업공간 범위(Claude는 브라우저·iOS 시뮬레이터·터미널·파일 편집을 패인으로 내장, Codex는 "Open with" 외부 에디터 위임 + ChatGPT 슈퍼앱 통합), 그리고 lazycodex는 GUI 없이 계획/검증 규율로 차별화한다는 점이다.

### Cited Findings
| 축 | OpenAI Codex (ChatGPT 앱 내) | Claude Code 데스크톱/웹 | lazycodex |
|---|---|---|---|
| 병렬성 | 프로젝트별 스레드, worktree 기본 활성, 상태 필터 — [Releasebot](https://releasebot.io/updates/openai/codex) | 멀티세션 사이드바, split view, 교차세션 메시징, task chip — [Docs](https://code.claude.com/docs/en/desktop) | 병렬 explorer/librarian 스웜, Team Mode — [lazycodex.ai](https://lazycodex.ai/) |
| 실행 위치 | local / worktree / cloud 모드 — [learn.chatgpt.com](https://learn.chatgpt.com/docs/features) | Local / Cloud / SSH / WSL — [Docs](https://code.claude.com/docs/en/desktop) | Codex가 실행되는 곳 |
| 샌드박스 | read-only/workspace-write/danger-full-access, Seatbelt/bwrap, 네트워크 기본 off — [codex-docs](https://www.codex-docs.com/en/docs/agent-approvals-security) | 클라우드는 격리 VM + 제한 네트워크 — [web-quickstart](https://code.claude.com/docs/en/web-quickstart); 로컬은 권한 모드 + 안전 분류기 — [Docs](https://code.claude.com/docs/en/desktop) | 해당 없음(hooks로 사전/사후 개입) |
| 승인 | Ask for approval / Approve for me / Full access / 프로필, auto_review 리뷰어 에이전트 — [sandboxing](https://developers.openai.com/codex/concepts/sandboxing) | Manual / Accept edits / Plan / Auto / Bypass — [Docs](https://code.claude.com/docs/en/desktop) | `$ulw-plan` 계획 승인 후 실행 — [Easton Dev](https://eastondev.com/blog/en/posts/ai/20260728-lazycodex-codex-agent-harness/) |
| diff | 인라인 코멘트, 청크/파일 stage·revert — [worktrees 문서 요약](https://developers.openai.com/codex/app/worktrees) | 줄 코멘트 일괄 제출, "Review code" AI 리뷰 — [Docs](https://code.claude.com/docs/en/desktop) | review-work 스킬, evidence gate |
| 머지/PR | commit·push·PR 앱 내, 사이드 패널 PR 리뷰 — [Developers Digest](https://www.developersdigest.tech/blog/chatgpt-work-codex-desktop-app) | PR CI 상태바, Auto-fix, Auto-merge(squash), PR 머지 시 세션 자동 아카이브 — [Docs](https://code.claude.com/docs/en/desktop) | — |
| 세션 기록 | 프로젝트별/시간순 목록 토글, 검색 — [Catalin's Tech](https://catalins.tech/codex-vs-claude-code-desktop-apps/) | 필터/그룹, CLI 세션 `/resume`, teleport — [Docs](https://code.claude.com/docs/en/desktop) | `.omo/boulder.json`, plans/*.md 디스크 상태 |
| 비용/사용량 | 모델 tier·effort 선택(Sol/Terra/Luna) — [Developers Digest](https://www.developersdigest.tech/blog/chatgpt-work-codex-desktop-app) | usage ring(컨텍스트 + 플랜 사용량) — [Docs](https://code.claude.com/docs/en/desktop) | 모델 라우팅으로 쿼터 절약 — [GitHub](https://github.com/code-yeongyu/lazycodex) |
| 백그라운드 자동화 | Automations → 리뷰 큐 — [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents) | Routines(스케줄/API/GitHub 이벤트, 클라우드) — [Build Fast with AI](https://blog.buildfastwithai.com/claude-code-desktop-redesign-2026) | `$ulw-loop` |

### Inferences
- Codex의 "샌드박스(무엇을 할 수 있나) × 승인(언제 묻나)" 2축 모델은 개념적으로 깔끔하지만 사용자에게 설명 비용이 크다; Claude의 "모드 하나 고르기"는 단순하지만 경계가 덜 명시적이다. 경쟁 앱은 단일 모드 선택 UI + 내부적으로 2축을 쓰는 절충이 가능.
- 두 앱 모두 worktree를 기본값으로 만든 것은 "병렬 에이전트 = 파일 충돌" 문제를 UX 레벨에서 제거하려는 수렴 설계.

### Gaps
- Codex 앱의 사용량/레이트리밋 가시화 UI(게이지 유무)를 확인하지 못함.
- 두 앱의 머지 충돌 처리(worktree 간 충돌 해결 UX) 자료 없음.

## 5. 공통 패턴(수렴 설계)과 고유한 점은? 왜 인기를 얻었나? 경쟁 앱 디자이너가 배울 구체 UI/UX는?

### Takeaway
수렴 패턴은 "에이전트 관제실": 좌측 세션/스레드 목록 → 중앙 대화 → 우측 diff/도구 패인, 세션별 worktree 자동 격리, diff 위 인라인 코멘트로 에이전트에 피드백, 앱 내 commit/PR, 로컬↔클라우드 핸드오프, 스케줄 자동화. 인기의 원인은 (1) 모델 성능 도약으로 장시간 자율 작업이 가능해진 시점에 (2) 여러 작업을 동시에 감독하는 표면이 필요해졌고 (3) 기존 구독(ChatGPT/Claude 플랜)에 번들되어 추가 비용 없이 쓸 수 있었기 때문이다.

### Cited Findings
- "5–10 agents in parallel", 개발자가 author에서 conductor로 — [Latent Space](https://www.latent.space/p/ainews-openai-codex-app-death-of)
- 이 "AI Agent Command Center" 패턴은 Conductor, CodexMonitor가 먼저 제시 — [Latent Space](https://www.latent.space/p/ainews-openai-codex-app-death-of)
- Codex 사용량은 GPT-5.2 출시(2025-12) 이후 두 배 이상, GPT-5.2-Codex 사용량이 2025-08 대비 20배 — [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents)
- 번들 가격: Codex는 ChatGPT 플랜(2026-07 이후 Free 포함), Claude 클라우드 세션은 별도 컴퓨트 요금 없이 구독 레이트리밋 공유 — [TechTimes](https://www.techtimes.com/articles/320087/20260710/chatgpt-work-free-every-plan-what-openais-codex-merger-changes-you.htm); [AICoder](https://aicoder.com/news/news-20260923-claude-code-cloud-sessions-ga)
- 슈퍼앱 통합은 Anthropic과의 경쟁 대응 및 제품 라인 단순화 목적 — [Wikipedia 검색 요약](https://en.wikipedia.org/wiki/Codex_(AI_agent))
- 디자인 품질이 선택 요인: Codex는 여백/정돈, Claude는 기능 밀도 but 혼잡 — [Catalin's Tech](https://catalins.tech/codex-vs-claude-code-desktop-apps/)
- 모델 성향이 앱 선택을 좌우: Codex=지시 이행·백엔드, Claude=맥락·프론트엔드 — [XDA](https://www.xda-developers.com/codex-technically-better-than-claude-code-stopped-using-it-for-one-specific-reason/)

**디자이너가 차용할 만한 구체 UI/UX 디테일 (출처는 각 항목의 위 섹션 참조)**
- diff 통계 칩(`+12 -1`)을 클릭 가능한 진입점으로 — [Claude Docs](https://code.claude.com/docs/en/desktop)
- diff 줄 코멘트를 모아서 한 번에 제출(Cmd+Enter) → 에이전트에 배치 피드백 — [Claude Docs](https://code.claude.com/docs/en/desktop)
- 청크 단위 stage/revert — [Codex worktrees 요약](https://developers.openai.com/codex/app/worktrees)
- 백그라운드 결과를 "리뷰 큐"로 — [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents)
- 트랜스크립트 밀도 3단계(Normal/Thinking/Verbose) — [Claude Docs](https://code.claude.com/docs/en/desktop)
- 메인 컨텍스트를 오염시키지 않는 side chat(`/btw`) — [Claude Docs](https://code.claude.com/docs/en/desktop)
- 에이전트가 후속 작업을 task chip으로 제안 → 새 격리 세션 — [Claude Docs](https://code.claude.com/docs/en/desktop)
- PR 머지 시 세션 자동 아카이브, CI auto-fix/auto-merge 토글 — [Claude Docs](https://code.claude.com/docs/en/desktop)
- `.worktreeinclude`로 `.env` 등 gitignored 파일 복제 — [Claude Docs](https://code.claude.com/docs/en/desktop)
- 컨텍스트+플랜 사용량을 한 개의 링 게이지로 — [Claude Docs](https://code.claude.com/docs/en/desktop)
- "Open with" 외부 에디터(Cursor/Zed/Finder/Terminal) — [Catalin's Tech](https://catalins.tech/codex-vs-claude-code-desktop-apps/)
- 사이드바 프로젝트별/시간순 뷰 토글, 플러그인 설치 2클릭 — [Catalin's Tech](https://catalins.tech/codex-vs-claude-code-desktop-apps/)
- 권한 카드 Allow once / Always allow / Deny(사이트·앱 단위 저장) — [Claude Docs](https://code.claude.com/docs/en/desktop)
- 계획을 파일(`plans/<slug>.md`)로 남기고 실행은 체크리스트 기반 durable 상태로 — [lazycodex.ai](https://lazycodex.ai/)
- "완료" 선언 전 evidence gate(테스트·LSP·수동 QA 스크린샷) — [lazycodex.ai](https://lazycodex.ai/); 제품 버전은 Claude의 autoVerify — [Claude Docs](https://code.claude.com/docs/en/desktop)

**고유한 점**
- Codex: ChatGPT 슈퍼앱 내 코딩 모드(비개발 Work와 한 셸), 샌드박스×승인 2축 + auto_review 리뷰어 에이전트, Automations 선발(GA 최초라는 평) — [Developers Digest](https://www.developersdigest.tech/blog/chatgpt-work-codex-desktop-app); [Latent Space](https://www.latent.space/p/ainews-openai-codex-app-death-of)
- Claude Code: SSH/WSL 환경, 브라우저·iOS 시뮬레이터·computer use 패인, 교차 세션 메시징, CLI 설정/세션 완전 공유, 모바일 Dispatch — [Claude Docs](https://code.claude.com/docs/en/desktop)
- lazycodex: GUI 없는 방법론 레이어, 무료 OSS, 검증 루프/모델 라우팅 — [GitHub](https://github.com/code-yeongyu/lazycodex)

### Inferences
- 주류 두 앱이 기능적으로 수렴한 만큼, 신규 경쟁 앱의 차별화 여지는 (a) 정돈된 시각 디자인·낮은 인지 부하(Claude의 "crowded" 비판 반대편), (b) 모델 중립/멀티 프로바이더, (c) "검증된 완료"를 1급 UX로(lazycodex가 하네스로 푸는 문제), (d) 비용 투명성(토큰/금액 단위) 쪽에 있을 것.
- 사용자가 도구를 고르는 기준이 앱 UX뿐 아니라 번들된 모델의 성향(백엔드 vs 프론트엔드)이라는 점은, 모델에 종속되지 않는 앱에게 기회이자 약점(구독 번들 가격을 못 따라감).

### Gaps
- 정량적 인기 지표(앱 다운로드 수, Claude Code 데스크톱 MAU) 1차 출처 부재.
- HN/Reddit 원문 스레드의 대표 코멘트를 직접 인용하지 못함(2차 요약 의존).
- Conductor, CodexMonitor 등 서드파티 커맨드센터 앱은 범위 밖이라 미조사.
