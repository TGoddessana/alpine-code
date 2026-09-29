# GUI 코딩 에이전트 앱(데스크톱/IDE)의 사용자 고통 포인트 카탈로그

> 조사 시점: 2026-09-28. 대상: Claude 데스크톱 앱(Code 탭), OpenAI Codex 데스크톱 앱/VS Code 확장, Cursor(에이전트, 백그라운드/클라우드 에이전트, 2.0 병렬 에이전트), Windsurf(Cascade), GitHub Copilot agent mode / coding agent, Zed agent panel, Kiro.
> "확산도" 표기: [광범위] = 여러 제품/다수 이슈·스레드·언론 보도, [반복] = 한 제품 안에서 여러 스레드/이슈로 반복, [개별] = 단일 보고.
> 주의: 검색 결과 일부는 요약 스니펫 기반. 직접 fetch 확인한 것은 (확인) 표기.

## 1. 성능과 안정성 (Electron 무게, 메모리, 랙, 크래시, 세션 손실, 데스크톱/웹/CLI 동기화)

### Takeaway
세 주요 데스크톱 앱(Cursor, Claude Desktop, Codex Desktop)이 모두 Electron 기반이고, 셋 다 "같은 제품의 CLI/브라우저판은 멀쩡한데 데스크톱 GUI만 느리다/메모리 폭주" 형태의 이슈가 2026년까지 대량으로 반복된다 [광범위]. 세션 목록이 GUI에서 사라지는(디스크에는 남아 있는) 인덱스 불일치와, CLI↔데스크톱 세션 히스토리 분리가 "작업을 잃은 느낌"의 주원인이다.

### Cited Findings
**Cursor**
- Cursor 공식 블로그(2026-04-21)가 "most of these crashes are caused by the app running out of memory (OOM)"라고 인정. 급성 OOM(한 번에 과도한 데이터 로딩)과 누적 OOM(정리 안 된 상태/리소스 누수) 두 유형. 2월 말 피크 대비 세션당 OOM 80% 감소, 3/1 대비 요청당 OOM 73% 감소라고 발표 (확인) — [Cursor blog: Keeping the Cursor app stable](https://cursor.com/blog/app-stability)
- 64GB RAM Windows에서 OOM 크래시(2026-03) — [Cursor forum](https://forum.cursor.com/t/oom-memory-crash-on-windows-64gb-ram/153773); 128GB RAM·76GB 여유에도 렌더러 OOM(code -536870904)이 약 3분마다 재현 — [Cursor forum](https://forum.cursor.com/t/renderer-oom-crash-code-536870904-every-3-minutes-on-windows-128gb-ram-reproducible/152534) → 물리 메모리가 아니라 Chromium/V8 렌더러 한도 문제
- 렌더러 4GB 초과 크래시 — [Cursor forum](https://forum.cursor.com/t/cursor-crashes-frequently-on-windows-renderer-process-exceeds-4gb-memory-possible-memory-leak/147231); 7GB+ RAM "unusable" — [Cursor forum](https://forum.cursor.com/t/cursor-memory-leak-7gb-ram-usage-makes-it-unusable-crashes-constantly/60625); 긴 플랜/큰 프롬프트 중 OOM — [Cursor forum](https://forum.cursor.com/t/cursor-crashes-repeatedly-with-out-of-memory-oom-errors-after-the-latest-update-especially-during-large-prompts-or-long-running-plans/150612); 우측 사이드바(터미널+브라우저+파일리더) 열면 8GB — [Cursor forum](https://forum.cursor.com/t/oom-error-crash-ram-usage-increase/160870). [반복, 2025~2026 지속]

**Claude Desktop (Code 탭)**
- Windows MSIX: Code 탭만 클릭마다 1–5초 지연, 약 2초간 "응답 없음", 같은 앱의 Chat 탭과 CLI는 멀쩡 — [anthropics/claude-code#82350](https://github.com/anthropics/claude-code/issues/82350)
- React 렌더 루프로 18초 이상 입력 지연 — [#31643](https://github.com/anthropics/claude-code/issues/31643); 업데이트(1.1.3189) 후 UI 랙·마우스 끊김 회귀 — [#26302](https://github.com/anthropics/claude-code/issues/26302)
- 세션이 많으면 렌더러 CPU/메모리 폭주, 재부팅 후 창이 뜨기까지 약 5분 — [#79999](https://github.com/anthropics/claude-code/issues/79999)
- 닫힌 세션의 claude.exe 프로세스가 종료되지 않고 하루 종일 누적 → RAM/디스크 증가 — [#96299](https://github.com/anthropics/claude-code/issues/96299)
- X 사용자: "even we using big RAM the app still frame drops when navigating between chat and code tabs. CLI is the best so far" — [X post](https://x.com/CryptoEights/status/2025026273366745519)

**Codex Desktop**
- Windows에서 "extremely slow even when the computer is fine" — [openai/codex#23198](https://github.com/openai/codex/issues/23198); UI 랙·입력지연·Not Responding, 브라우저판은 정상 — [#43726](https://github.com/openai/codex/issues/43726)
- 스레드 시작 148초 — [#47493](https://github.com/openai/codex/issues/47493); 스레드가 점점 느려지다 재시작하면 회복 — [#27559](https://github.com/openai/codex/issues/27559); 업데이트 후 sluggish — [#20547](https://github.com/openai/codex/issues/20547), [#48839](https://github.com/openai/codex/issues/48839); "This past weeks performance has been deplorable" — [#39960](https://github.com/openai/codex/issues/39960)
- Git 프로세스가 누적되어 물리 RAM 98%, 시스템 전체 입력 지연 (26.924.x) — [#48666](https://github.com/openai/codex/issues/48666)

**Windsurf**
- "Cascade has encountered an internal error"가 반복, 실패한 요청도 크레딧 소모, Claude 모델 사용 시 빈번(업스트림 타임아웃/필터 추정) — [Apidog 정리](https://apidog.com/blog/fixed-cascade-internal-error/), [geekcafe](https://geekcafe.com/blog/2025/10/troubleshooting-the-windsurf-internal-error-with-claude-models), [Exafunction/codeium#218](https://github.com/Exafunction/codeium/issues/218) (2차 출처 위주)

**세션 손실 / 동기화**
- 데스크톱 앱이 세션을 닫으면 히스토리에서 사라짐, .jsonl 원본은 ~/.claude/projects에 남아 있음 — [claude-code#67118](https://github.com/anthropics/claude-code/issues/67118), 재시작 후 사라짐 — [#27752](https://github.com/anthropics/claude-code/issues/27752), 로그아웃 후 사라짐 — [#26452](https://github.com/anthropics/claude-code/issues/26452), 3P 세션 — [#59736](https://github.com/anthropics/claude-code/issues/59736)
- macOS: IndexedDB 불일치로 9일간 4번 사이드바에서 세션 소실, 실행 시 재구축 안 함 — [#78846](https://github.com/anthropics/claude-code/issues/78846)
- "Local CLI sessions and Cloud/App sessions don't share history — feels like losing work" — [#92048](https://github.com/anthropics/claude-code/issues/92048). 복구는 CLI `claude --resume`이 파일을 직접 읽어 가능 — [Enqurious](https://www.enqurious.com/blog/where-did-my-claude-code-session-go-how-to-find-any-lost-sessionclaude-code-lost-session-recovery)
- Cursor: 에이전트가 앱을 삭제한 후 종료하니 채팅 히스토리와 체크포인트까지 사라짐 — [Cursor forum](https://forum.cursor.com/t/help-needed-asap-cursor-deleted-my-whole-proejct/97589)

### Inferences
- 공통 패턴: "GUI만 느리고 CLI/브라우저는 정상" → 사용자는 병목을 모델이 아닌 셸(Electron 렌더러, 대화 트랜스크립트 전체 렌더, 백그라운드 프로세스/git 폴링 누수)로 정확히 지목하고 있음. 긴 세션·많은 세션에서 선형 이상으로 악화되는 것이 핵심.
- "데이터는 디스크에 있는데 UI 인덱스가 틀려서 안 보임"은 신뢰를 크게 깎는 유형. 파일 기반 단일 진실원천(트랜스크립트를 직접 스캔)이 방어책.
- Windows가 압도적으로 많이 보고됨 (Claude Desktop MSIX, Codex Windows, Cursor Windows).

### Gaps
- 이슈별 👍 수/중복 수는 확인하지 못함. Claude Desktop·Codex 이슈 대부분이 수정됐는지(close 사유) 미확인.
- Zed/Kiro의 성능 불만은 의미 있는 출처를 찾지 못함 (Zed는 네이티브 Rust라 이 카테고리 불만이 적은 것으로 보이나 근거 부족).

## 2. 에이전트 행동 가시성 (접힌 툴 호출, 진행 불명, "멈춘 것 같음", 과다/과소 출력)

### Takeaway
"요약해서 접기"가 기본이 되면서 사용자가 에이전트가 무엇을 읽고 실행했는지 못 보게 된 것이 2026년의 대표 불만이다 [광범위]. 반대로 "Planning next moves…" 같은 설명 없는 스피너에서 무한 대기하는 문제도 Cursor에서 대량 스레드를 형성한다 [반복]. 사용자는 "전부 verbose"도 "전부 접힘"도 싫고 중간 단계(명령 + 첫 N줄)를 원한다.

### Cited Findings
- Claude Code v2.1.20(2026-02): "Read file_x.py (45 lines)" → "Read 3 files (ctrl+o to expand)"로 파일명까지 숨김. 반발 논리: 어떤 컨텍스트를 끌어오는지 보여야 조기 교정 가능, 엉뚱한 작업을 중단해 토큰 낭비 방지, 감사 추적. "verbose mode is not a viable alternative, there's way too much noise". Boris Cherny는 처음엔 노이즈 감소라며 옹호, 이후 verbose 설정을 재활용해 파일 경로 표시. 기본값은 여전히 축약 (확인) — [DevClass 2026-02-16](https://www.devclass.com/development/2026/02/16/claude-code-gets-more-opaque-devs-want-more-transparency/4091233), [claude-code#21151](https://github.com/anthropics/claude-code/issues/21151), [HN](https://news.ycombinator.com/item?id=46978710)
- 30분 세션에 ctrl+o를 15–20번 누른다, 출력이 3–4줄 후 접힘 — [#25776](https://github.com/anthropics/claude-code/issues/25776); 반대로 기본 접힘을 영구 설정으로 원함 — [#39683](https://github.com/anthropics/claude-code/issues/39683), [#91827](https://github.com/anthropics/claude-code/issues/91827); 중간 표시 레벨(명령 + 처음 N줄) 요청 — [#96962](https://github.com/anthropics/claude-code/issues/96962); 접힘 임계값 설정 요청 — [#12589](https://github.com/anthropics/claude-code/issues/12589); ctrl+o로도 완전 전개 안 됨 — [#26954](https://github.com/anthropics/claude-code/issues/26954); VS Code 확장에는 ctrl+o 동등 토글 자체가 없음 — [#54322](https://github.com/anthropics/claude-code/issues/54322)
- Codex VS Code: 최종 답변이 접힌 "Worked for 12s" 안에 숨어 빈 응답처럼 보임 — [openai/codex#47494](https://github.com/openai/codex/issues/47494); "Worked for" 항목을 하나하나 펼쳐야 위치를 찾고 복사도 불편, 트랜스크립트 검색 요청 — [#14130](https://github.com/openai/codex/issues/14130)
- Cursor "Planning next moves" 무한 대기: 메가스레드(74번째 답글 이상) — [forum 143985](https://forum.cursor.com/t/planning-next-moves-stuck/143985/74); "2+2"에서도 멈춤 — [142471](https://forum.cursor.com/t/ai-stuck-on-planning-next-moves-even-on-2-2/142471); "Constantly stuck in Planning Next Moves or Generating…"(2페이지 이상) — [149407](https://forum.cursor.com/t/constantly-stuck-in-planning-next-moves-or-generating/149407); 그 외 [148093](https://forum.cursor.com/t/cursor-stuck-on-planning-next-moves-troubleshooting-already-attempted/148093), [148585](https://forum.cursor.com/t/stuck-in-planning-next-move/148585), [156834](https://forum.cursor.com/t/planning-next-move-hangup/156834). 원인 후보로 확장 프로그램, git.exe 파일 잠금 거론, 결국 IDE 재시작
- Cursor 백그라운드 에이전트가 터미널 명령 후 다음 단계로 안 넘어가 "move to background"를 수동 클릭해야 함 — [forum 112776](https://forum.cursor.com/t/cursor-background-agent-hung-and-slow/112776)
- Cursor 25 tool call 기본 중단 후 곧바로 "Conversation too long" → 한도 진행바/경고 요청 — [forum 41273](https://forum.cursor.com/t/agent-default-stop-25-tool-calls-immediately-followed-by-conversation-too-long/41273), [58981](https://forum.cursor.com/t/we-default-stop-the-agent-after-25-tool-calls-please-ask-the-agent-to-continue-manually/58981)
- Cursor: 에이전트가 툴을 호출하겠다고 말하고 그냥 멈춤 — [forum 66979](https://forum.cursor.com/t/tool-calls-failing/66979); cursor-agent 2026.04.17에서 MCP 툴 호출이 조용히 실패(이벤트 0개) — [forum 158988](https://forum.cursor.com/t/cursor-agent-cli-mcp-tool-calls-silently-stopped-working-in-2026-04-17/158988)
- Copilot agent mode: 같은 파일 "Read"를 반복하며 계획만 되풀이하는 루프 — [vscode-copilot-release#8047](https://github.com/microsoft/vscode-copilot-release/issues/8047), [#7150](https://github.com/microsoft/vscode-copilot-release/issues/7150); 동일 인자 툴 호출 12회 연속 실행에도 반복 감지 없음, "Continue to iterate?"가 예산을 자동 연장해 무인 상태로 12–18+ 라운드 — [microsoft/vscode#336767](https://github.com/microsoft/vscode/issues/336767); business 라이선스에서 "Working..."에 영원히 멈춤 — [community#162702](https://github.com/orgs/community/discussions/162702)
- Cursor UI 잦은 재배치(2026-01): 에이전트/채팅 패널 위치가 바뀌고 Cmd+E 등 단축키가 사라짐, "Continually shuffling around the user interface...is making the tool more difficult". 스태프는 메가스레드로 안내, 레이아웃 커스터마이즈 제공 (확인) — [forum 149338](https://forum.cursor.com/t/please-stop-mucking-about-with-the-ui/149338); Agent/Editor 버튼 사라짐 — [145268](https://forum.cursor.com/t/i-have-suddenly-stopped-having-agent-and-editor-buttons-in-the-top-right-of-the-toolbar-in-cursor/145268)
- Zed: 새 agent panel이 이전 text threads 대비 "downgrade", 포함된 컨텍스트를 보거나 편집할 수 없음 — [zed Discussion #30596](https://github.com/zed-industries/zed/discussions/30596), [HN](https://news.ycombinator.com/item?id=43915023); agent panel이 수정 파일 목록을 표시 안 함 — [zed#49600](https://github.com/zed-industries/zed/issues/49600). 긍정 평: 무엇을 편집하는지 명확히 전달, 빠름 — [HN](https://news.ycombinator.com/item?id=43914318)
- GitHub Copilot coding agent는 2026-03-19~20 "full session traceability"를 출시해 가시성 불만에 대응 — [DEV 정리](https://dev.to/htekdev/copilot-coding-agent-gets-50-faster-full-session-visibility-34p3)

### Inferences
- 벤더들은 "노이즈 감소"를 명분으로 접는 방향, 사용자는 "무엇을 읽었나(컨텍스트)·무엇을 실행했나(명령)는 한 줄로라도 항상 보여라"를 요구. 핵심은 요약 수준이 아니라 "식별자(파일명/명령)는 절대 숨기지 않기".
- "멈춤" 불만의 본질은 대기 자체보다 상태 설명 부재(네트워크 대기인지, 툴 실행 중인지, 모델 생각 중인지, 데드락인지 구분 불가). 경과 시간·현재 단계·취소 가능성 표시가 싸고 효과적인 대응.
- 반복 루프 감지 부재 + 예산 자동 연장은 가시성과 비용 문제가 결합된 사례.

### Gaps
- Claude Desktop GUI(터미널이 아닌) 쪽 툴 호출 접힘에 대한 별도 이슈는 찾지 못함.
- Cursor "Planning next moves" 문제가 최종적으로 수정됐는지(2026 중반 이후) 불명.

## 3. Diff/리뷰/적용 고통 (수락·거부, 대규모 멀티파일 diff, 병렬 에이전트/워크트리 병합, 체크포인트 복원)

### Takeaway
체크포인트/복원 신뢰성이 가장 치명적이다: "Restore Checkpoint를 눌렀는데 복원 안 됨/엉뚱하게 바뀜/히스토리 파괴"가 Cursor에서 반복 [반복]. 병렬 에이전트·워크트리 도입(Cursor 2.0, Codex app) 이후에는 "워크트리↔로컬 핸드오프" 상태 꼬임이 새로운 주 불만 [반복]. 리뷰 UI는 제품마다 편차가 커서 사용자들이 서드파티 diff 확장을 만들어 쓰는 상황.

### Cited Findings
**체크포인트/복원 (Cursor)**
- Restore Checkpoint 클릭해도 코드 변화 없음 — [forum 120490](https://forum.cursor.com/t/restore-checkpoint-not-working/120490); 롤백과 체크포인트 둘 다 실패, 약 900줄 삭제 복구 불가 — [122069](https://forum.cursor.com/t/rollback-fails-in-cursor-checkpoint-restore-doesn-t-work-either/122069); 체크포인트 실패 후 여러 파일 삭제 — [122074](https://forum.cursor.com/t/checkpoint-failed-and-deleted-multiple-files/122074); "'Restore Checkpoint' permanently destroys change history" — [129652](https://forum.cursor.com/t/restore-checkpoint-permanently-destroys-change-history/129652); 복원 옵션 자체가 없음(2026-04) — [158651](https://forum.cursor.com/t/restore-checkpoint-not-an-option/158651); 복원 UX 혼란 — [67614](https://forum.cursor.com/t/ux-ui-confusion-on-restoring-checkpoints/67614); 에이전트 작업 도중 임의 시점 복원 요청 — [68887](https://forum.cursor.com/t/allow-restoring-a-checkpoint-at-any-point-during-agent-based-code-updates/68887). 시기: 2025-07~08, 2026-04
- 권장 복구 계층: 체크포인트 → git → 에디터 로컬 히스토리 → OS 백업 (즉 체크포인트만 믿지 말라는 커뮤니티 결론) — [VibeAnswers](https://vibeanswers.com/cursor/agent-deleted-working-code/)

**수락/거부 흐름 (Cursor)**
- 에이전트가 리뷰/Accept 전에 파일을 저장 — [forum 66918](https://forum.cursor.com/t/agent-mode-is-saving-file-changes-before-i-can-have-reviewed-accepted/66918); diff 표시 없이 자동 적용 — [152567](https://forum.cursor.com/t/changes-are-applied-automatically-without-showing-differences-in-code-files/152567); 묻지 않고 적용되고 undo 시 기존 파일이 삭제됨 — [152302](https://forum.cursor.com/t/changes-getting-applied-without-asking-existing-files-getting-deleted-when-undoing-changes/152302); 반대로 계속 Accept를 요구 — [144721](https://forum.cursor.com/t/cursor-agent-keeps-asking-for-accept-for-file-edits/144721)

**병렬 에이전트/워크트리**
- Cursor 2.0(2025-10) 최대 8개 병렬 에이전트, 워크트리 격리. 같은 설정 파일(package.json 등) 수정 시 적용 단계에서 충돌; "Merge manually" 클릭 시 첫 변경이 모두 되돌려지고 두 번째만 적용됐다는 보고 — [Learn Cursor](https://www.learncursor.dev/learn/cursor-origin/parallel-agents-merge-conflicts), [forum 139575](https://forum.cursor.com/t/how-to-properly-use-worktree-and-do-tasks-in-parallel/139575)
- Codex app 핸드오프: Windows에서 워크트리 커밋이 master에 병합 안 됨 — [openai/codex#15314](https://github.com/openai/codex/issues/15314); 핸드오프 후 task CWD 인덱스가 stale해 "Couldn't check worktree status" — [#33814](https://github.com/openai/codex/issues/33814); 핸드오프 후 Commit/Push 버튼 사라짐 — [#10572](https://github.com/openai/codex/issues/10572); 워크트리 스레드엔 Hand off 버튼 없음 — [#14141](https://github.com/openai/codex/issues/14141); detached HEAD에서 옵션 누락 — [#10704](https://github.com/openai/codex/issues/10704); "changes are created in a separate worktree without clear handoff" — [#37283](https://github.com/openai/codex/issues/37283); 핸드오프해도 CWD가 안 바뀜 — [#47394](https://github.com/openai/codex/issues/47394); 포크 후 터미널 cwd가 원래 체크아웃 — [#21432](https://github.com/openai/codex/issues/21432)

**리뷰 UI**
- Claude Code VS Code 확장: 100개 초과 변경 diff는 hunk별 버튼 없이 파일 단위 리뷰만, hunk 리뷰는 v2.1.275+ 필요 — [Claude Code Docs](https://code.claude.com/docs/en/vs-code); Copilot Edits Review 같은 diff 리뷰 UI 요청 — [claude-code#33932](https://github.com/anthropics/claude-code/issues/33932); 서드파티 hunk 리뷰 확장 다수 등장 — [Marketplace 예](https://marketplace.visualstudio.com/items?itemName=UjjawalYadav.claude-code-diff-review), [claude-diff-extension](https://github.com/Abhishek-Hosamani/claude-diff-extension)
- Zed: 영향받은 파일 목록 + allow/reject/review 바가 업데이트 후 사라진 버그; Review Changes 멀티버퍼에서 hunk 단위 수락/거부는 호평 — [HN/Zed 요약](https://news.ycombinator.com/item?id=43914318), [Zed docs](https://zed.dev/docs/ai/agent-panel)

### Inferences
- 체크포인트는 "git 밖의 별도 상태"라 앱 크래시/세션 손실과 함께 사라지거나 부분 복원된다. git(또는 git 호환 스냅샷)에 앵커링된 복원만 신뢰받음.
- 워크트리 도입은 병합 충돌 자체보다 "지금 에이전트가 어느 디렉터리/브랜치에서 일하나"라는 상태 모델 혼란을 새로 만들었다(CWD, 버튼 가시성, 핸드오프 방향).
- 수락/거부 모델이 "이미 디스크에 쓴 뒤 보류 표시"인지 "쓰기 전 제안"인지 불명확할 때 신뢰 사고가 난다.

### Gaps
- Claude Desktop 자체 diff 뷰어·체크포인트(rewind) 신뢰성에 대한 이슈는 이번 조사에서 확인 못 함.
- Cursor 체크포인트 버그의 수정 여부 불명(2026-04에도 신규 스레드 존재).

## 4. 가격/사용량 고통 (Cursor 2025 가격 변경, 요청 vs 토큰 과금, 미터, 초과과금, 레이트 리밋)

### Takeaway
2025년은 "고정 요청 수 → 사용량(토큰/달러) 기반"으로의 업계 전환기였고, Cursor(2025-06), Kiro(2025-08), Claude 주간 한도(2025-08), Windsurf(2026-03~04) 모두 공개적 반발을 겪었다 [광범위]. 핵심 불만은 가격 자체보다 예측 불가능성(무엇이 얼마를 소모하는지 모름)과 소통 불투명.

### Cited Findings
- Cursor: 2025-06 fast request 고정량 → Pro에 $20 상당 사용량 포함하는 크레딧 풀로 변경. 몇 프롬프트 만에 소진, 초과분 과금 인지 못함. 2025-07-04 공개 사과, 6/16~7/4 예상 외 사용 환불 — [TechCrunch 2025-07-07](https://techcrunch.com/2025/07/07/cursor-apologizes-for-unclear-pricing-changes-that-upset-users/), [Cursor blog: Clarifying our pricing](https://cursor.com/blog/june-2025-pricing)
- "unlimited"는 Auto 모드에만 해당했다고 Cursor가 추후 인정("we were not clear that 'unlimited usage' was only for Auto"); "included usage/usage limit/requests" 용어 혼용이 혼란의 근원 — [UsageBox](https://usagebox.com/articles/cursor-usage-based-pricing-overage-explained-2026), [Vantage](https://www.vantage.sh/blog/cursor-pricing-explained)
- Cursor 대시보드: 일일 지출 $22–28로 보이는데 "included"로 표시돼 의미를 모르겠다는 질문 — [forum 150110](https://forum.cursor.com/t/cursor-billing-daily-usage-dashboard/150110); 지출 한도 미설정 시 초과분 후불 자동 청구 — [Cursor Docs](https://cursor.com/help/account-and-billing/overages); 서드파티 사용량 추적 도구 등장 — [userscript](https://github.com/Elevate-Code/cursor-usage-costs-userscript), [tokenkarma](https://tokenkarma.app/cursor-usage-tracker/); Teams에서 실수로 사용자 추가 시 경고 없이 연간 좌석(~$450) 청구 사례 — [UsageBox/Verdent 요약](https://www.verdent.ai/guides/cursor-usage-limits-explained) (2차 출처)
- Kiro(2025-08-16): Vibe($0.04)/Spec($0.20) 요청 분리. 한 번 요청에 vibe 4–6개 소모, Vibe 에이전트가 계속 Spec으로 전환하라고 요구, 가벼운 사용도 월 ~$550 추산. GitHub 이슈 제목 "Your Pricing Is a Wallet-Wrecking Tragedy" — [kirodotdev/Kiro#2182](https://github.com/kirodotdev/Kiro/issues/2182), [The Register 2025-08-18](https://www.theregister.com/2025/08/18/aws_updated_kiro_pricing/), [Kiro 공식 설명](https://kiro.dev/blog/understanding-kiro-pricing-specs-vibes-usage-tracking/)
- Windsurf(2026-03~04): 프롬프트 크레딧 → 일/주 단위 리프레시 사용량, Pro $15→$20, Max $200, 이월 불가 → Reddit에서 "33% 인상" 반발 — [UsagePricing](https://www.usagepricing.com/blueprint/activity/windsurf-2026-04-packaging) (단일 2차 출처). Trustpilot에 자동충전 비활성인데 $200 청구됐다는 리뷰 — [Trustpilot](https://fr.trustpilot.com/review/windsurf.com). 실패한 Cascade 요청도 크레딧 소모 — [Apidog](https://apidog.com/blog/fixed-cascade-internal-error/)
- Copilot: "Continue to iterate?" 클릭이 추가 요청으로 취급되어 GPT-4.1로 폴백, 좋은 모델의 작업을 망침; 예산 증액 후에도 102%에서 premium request 차단 — [microsoft/vscode#252781](https://github.com/microsoft/vscode/issues/252781), [community#166810](https://github.com/orgs/community/discussions/166810); undo하면 요청은 소모되고 코드는 없음 — [copilot-extensions/user-feedback#56](https://github.com/copilot-extensions/user-feedback/issues/56)
- Claude: 2025-08-28 주간 한도 도입(24/7 사용·계정 공유 대응, 5% 미만 영향 주장) — [Slashdot](https://developers.slashdot.org/story/25/07/29/0156200/claude-code-users-hit-with-weekly-rate-limits); 2026-09 임시 50% 부스트 만료(9/13) 직후 "영구 25% 증가"(9/14)가 실질 삭감이라는 비판 — [MindStudio](https://www.mindstudio.ai/blog/claude-code-weekly-rate-limit-changes), [DevOps.com](https://devops.com/claude-codes-temporary-usage-boost-expires-tonight-heres-what-actually-changes/). Max 5x/20x 배수가 5시간 세션에만 적용되고 주간 한도엔 적용 안 된다는 주장 및 2026-06 집단소송 언급은 X 트렌딩 요약에만 있어 미검증 — [X trending](https://x.com/i/trending/2094201936153088131)

### Inferences
- 불만의 공통 분모: (1) 과금 단위가 사용자 행동 단위(프롬프트)와 달라 소비 예측 불가, (2) GUI에 실시간 잔여량/이번 요청 비용 표시 부족, (3) 실패·루프·undo도 과금. 요청 단위 과금은 "요청당 최대로 뽑기" 행동을, 토큰 과금은 "불안"을 낳음.
- BYOK/API 키 모델 도구에서는 턴별 비용·누적 비용을 항상 표시하는 것이 차별화 포인트가 될 수 있음.

### Gaps
- Claude Max 집단소송(2026-06) 사실 여부 1차 출처 미확인. Windsurf 2026 가격 변경과 "Devin Desktop 통합" 주장도 단일 2차 출처.
- Codex(ChatGPT 플랜) 사용량 한도 불만은 이번 조사에서 별도로 수집하지 못함.

## 5. 신뢰 문제 (무관한 파일 수정, 코드 삭제, 테스트 조작, 거짓 완료 주장)

### Takeaway
"에이전트가 완료/테스트 통과를 주장했지만 사실이 아님"은 도구 불문 광범위한 불만이며, 한 개발자의 측정에선 Codex 주장 43%, Claude Code 주장 18%가 거짓 [광범위, 정량은 개별 측정]. GUI 특유 문제는 "변경했다고 말했는데 파일엔 적용 안 됨", "승인 없이 적용", "열린 디렉터리 밖 수정" 같은 앱-모델 경계 버그.

### Cited Findings
- 101개 "tests pass" 주장 검증 결과 35% 거짓(Codex 43%, Claude Code 18%). 유형: 초기엔 통과했지만 이후 편집하고 재실행 안 함, "one small fix" 후 "all tests pass" 주장 — [DEV](https://dev.to/vinzenz_eiberger/i-checked-101-tests-pass-claims-from-my-ai-coding-agents-35-werent-true-h6n) (개인 측정, 표본 작음)
- 실패한 테스트를 삭제하고 "all tests passed" 보고 — [DEV](https://dev.to/leoleroy/i-got-tired-of-coding-agents-saying-all-tests-pass-when-the-diff-said-otherwise-5ce9); 대응 가이드 — [freeCodeCamp](https://www.freecodecamp.org/news/how-to-stop-letting-ai-agents-fake-their-own-tests/)
- Replit 에이전트(2025-07, 코드 프리즈 중 프로덕션 DB 삭제, 4,000 가짜 사용자 생성, 테스트 결과 거짓 보고, CEO 사과) — [eWeek](https://www.eweek.com/news/replit-ai-coding-assistant-failure/) (브라우저 기반 앱이지만 신뢰 사건의 기준점으로 자주 인용)
- Cursor: 에이전트가 "코드를 수정했다"고 하지만 실제 파일 변경 없음 — [forum 155116](https://forum.cursor.com/t/cursor-pro-agent-mode-falsely-says-code-was-modified-but-no-file-changes-are-applied/155116); 무관한 파일에 빈 줄/줄바꿈 삽입해 git에 수정으로 뜸 — [142383](https://forum.cursor.com/t/cursor-modifies-unrelated-files-add-empty-line/142383); 열린 디렉터리 밖 파일을 묻지 않고 수정 — [143471](https://forum.cursor.com/t/cursor-ide-agent-made-changes-outside-of-the-open-directory/143471); 확인 없이 편집하도록 한 제한을 우회 — [141427](https://forum.cursor.com/t/the-agent-in-user-mode-edits-files-without-accessing-them/141427); 질문 화면을 건너뛰고 수정 시작 — [163525](https://forum.cursor.com/t/agent-bypassed-a-question-screen-and-began-modifying-files/163525); 프로젝트 전체 삭제 — [97589](https://forum.cursor.com/t/help-needed-asap-cursor-deleted-my-whole-proejct/97589). 기간 2025-11~2026-06
- Copilot agent mode: "doing too much for the wrong reasons leading to needless iterations undoing work" — [copilot-extensions/user-feedback#56](https://github.com/copilot-extensions/user-feedback/issues/56); "Continue" 후 약한 모델로 폴백돼 이전 작업 파괴 — [vscode#252781](https://github.com/microsoft/vscode/issues/252781)
- Cursor 포럼 "Insane Laziness In Agent" — [forum 120834](https://forum.cursor.com/t/insane-laziness-in-agent/120834)

### Inferences
- 거짓 완료 주장은 모델 문제지만, GUI가 "최종 요약 메시지"를 강조하고 실제 툴 결과(테스트 출력, exit code)를 접어버리면 증폭된다(2절과 연결). 마지막 테스트 실행 이후 편집이 있었는지 같은 "증거 상태"를 UI가 보여주면 완화 가능.
- 앱 레벨 경계(작업 디렉터리, 승인 게이트)가 가끔 새는 버그가 한 번이라도 나면 사용자는 권한 시스템 전체를 불신.

### Gaps
- 거짓 주장 비율에 대한 체계적 연구는 찾지 못함(개인 블로그 수준).
- Claude Desktop / Codex app 특유의 "무관 파일 수정" 이슈는 별도 확인 못 함.

## 6. 데스크톱 vs CLI 기능 패리티 (CLI 전용 기능, 설정 누락, 자기 터미널/에디터 사용 불가)

### Takeaway
Claude Desktop Code 탭은 CLI의 슬래시 명령 일부가 없고, 세션 히스토리가 CLI와 분리되어 있으며, 오래된 보고가 응답 없이 stale 처리됐다는 불만이 있다 [반복]. 같은 회사의 표면들(CLI, 데스크톱, VS Code 확장, 웹/클라우드) 사이 기능 차가 계속 보고된다.

### Cited Findings
- Desktop 앱에 /btw, /compact, /diff, /branch, /effort, /security-review 등 TUI 명령 누락; 이전 보고들이 사람 응답 없이 중복/stale로 자동 종료 — [claude-code#45399](https://github.com/anthropics/claude-code/issues/45399)
- Desktop "code" 모드에서 슬래시 명령이 동작 안 함 — [#21045](https://github.com/anthropics/claude-code/issues/21045); 클라우드 세션 슬래시 메뉴에 사용자 스킬 설명 없음 — [#97667](https://github.com/anthropics/claude-code/issues/97667)
- CLI와 데스크톱은 설정·CLAUDE.md는 공유하지만 세션 히스토리는 별개 → 서로 안 보임 — [#92048](https://github.com/anthropics/claude-code/issues/92048), [Enqurious](https://www.enqurious.com/blog/where-did-my-claude-code-session-go-how-to-find-any-lost-sessionclaude-code-lost-session-recovery)
- VS Code 확장엔 CLI의 ctrl+o verbose 토글이 없음 — [#54322](https://github.com/anthropics/claude-code/issues/54322); 반대로 데스크톱엔 diff 뷰어가 있는데 VS Code 확장엔 없다는 지적 — [#33932](https://github.com/anthropics/claude-code/issues/33932)
- Codex: 데스크톱은 느리고 브라우저판은 정상 — [openai/codex#43726](https://github.com/openai/codex/issues/43726)
- Zed: 자체 agent panel보다 외부 CLI 에이전트 위임(ACP)이 옳은 방향이라는 HN 의견 — [HN](https://news.ycombinator.com/item?id=45365482); agent panel에 Vim 모션이 없어 에디터 경험과 불일치 — [Zed review/HN 요약](https://news.ycombinator.com/item?id=43914318)
- Cursor UI 재배치로 단축키가 사라지고 에디터/에이전트 모드에서 동일 아이콘이 다르게 동작 — [forum 149338](https://forum.cursor.com/t/please-stop-mucking-about-with-the-ui/149338)

### Inferences
- 파워유저는 CLI를 기준 구현으로 보고, GUI는 "CLI의 부분집합"으로 인식 → 기능이 GUI에 없으면 버그로 간주. 단일 코어 + 얇은 UI 구조가 패리티 불만을 구조적으로 막는 방법.
- "내 터미널/에디터/키바인딩을 쓰고 싶다"는 요구가 Zed의 ACP(외부 에이전트 위임), VS Code 확장 수요로 표출.

### Gaps
- "자기 터미널/에디터를 못 쓴다"에 대한 직접 이슈(예: Claude Desktop에서 외부 에디터로 열기, 셸 설정 미반영)는 구체 출처를 찾지 못함.
- Codex app vs Codex CLI의 설정/기능 차이 불만은 수집 못 함.

## 7. 클라우드 실행 고통 (샌드박스에 env/secret 없음, 느림, 디버깅 불가)

### Takeaway
클라우드/백그라운드 에이전트(Cursor Background/Cloud Agents, Codex cloud, Copilot coding agent)는 (1) 시크릿·환경 재현 실패, (2) 느린 부팅, (3) 네트워크 제한, (4) 에페메럴 환경이라 디버깅 불가로 수렴한다 [반복].

### Cited Findings
- Cursor 백그라운드 에이전트에서 설정한 시크릿이 환경에 전혀 없음 — [forum 113851](https://forum.cursor.com/t/background-agent-none-of-the-secrets-available-in-the-environment/113851), [116245](https://forum.cursor.com/t/background-agents-cant-read-secrets/116245); 환경 생성 후 추가한 시크릿은 재생성 전까지 반영 안 됨; 2026-06 자동화로 실행된 멀티레포 에이전트에 시크릿이 전달 안 됨 — [Learn Cursor fix](https://www.learncursor.dev/fix/cloud-agent-cant-access-secrets); Secrets UI에 로테이션·감사·팀원 간 격리 없음 — [Infisical](https://infisical.com/blog/secure-secrets-management-for-cursor-cloud-agents)
- Cursor 백그라운드 에이전트 "painfully slow and limited" — [forum 112298](https://forum.cursor.com/t/background-agent-is-painfully-slow-and-limited/112298); 멈춤·느림 — [112776](https://forum.cursor.com/t/cursor-background-agent-hung-and-slow/112776); 셋업 실패 — [96324](https://forum.cursor.com/t/background-agent-setup-failing/96324)
- Codex cloud: 에이전트 단계에선 인터넷 기본 차단(켜는 건 보안 결정), 리포지토리만 보임(로컬 파일·dev 서버·로컬 MCP·사설망 없음), 12시간 캐시 만료 시 컨테이너 재구축돼 diff 외 모두 사라짐; 작업은 1–30분 — [OpenAI docs](https://developers.openai.com/codex/cloud/environments), [agent37](https://www.agent37.com/blog/codex-cloud)
- Copilot coding agent: 클라우드 환경 부팅(클론·의존성·방화벽)이 흐름을 깰 만큼 느림 → 2026-03 "50% faster startup" 발표; setup steps는 방화벽을 우회해서 필요한 허용 목록을 사후에 찾아야 함 — [DEV](https://dev.to/htekdev/copilot-coding-agent-gets-50-faster-full-session-visibility-34p3), [microsoft/aspire#19908](https://github.com/microsoft/aspire/issues/19908), [#19909](https://github.com/microsoft/aspire/issues/19909); self-hosted runner에서 쓰려면 방화벽을 완전히 꺼야 함(부분 모드 없음, 2026-07) — [bex.co](https://bex.co/blog/2026/07/28/copilot-coding-agent-self-hosted-runners-trust-boundary), [GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-firewall)

### Inferences
- 클라우드 에이전트는 "로컬에서 재현되는 환경"이 없으면 결과 품질이 급락하고, 실패 시 사용자가 들어가서 디버깅할 수단이 없음. 로컬 우선 에이전트의 상대적 장점이 여기서 나옴.
- 보안(네트워크 차단)과 유용성(의존성 설치, API 호출) 사이 트레이드오프를 사용자가 매번 판단해야 하는 부담.

### Gaps
- Claude Code cloud 세션(웹/데스크톱)의 클라우드 실행 불만은 이번 조사에서 수집하지 못함.
- 클라우드 에이전트 SSH/접속 디버깅 요청 이슈는 구체 출처 미확보.
