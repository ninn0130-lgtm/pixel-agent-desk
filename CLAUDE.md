# CLAUDE.md — Pixel Agent Desk

## 현재 진행 상태 (2026-03-06 기준)
- ✅ **Phase 3A:** 데이터 파이프라인 정비 (JSONL 스캐너, 훅 메타데이터 저장) 완료
- ✅ **Phase 3B-1:** SSE 이벤트 스트림 완료
- ✅ **Phase 3B-2:** REST API 확장 완료
- ✅ **Phase 3B-3:** 대시보드 UI 리디자인 완료
- ✅ **Phase 3 전체 완료** — 백엔드 파이프라인 및 대시보드 UI 모두 구현 완료
- ✅ **훅 최적화:** HTTP 훅 전환 (hook.js 프로세스 스폰 제거), tool_name/notification_type/team 필드 추출
- ✅ **PID 정확도:** transcript_path 기반 lsof PID 탐지, 크로스플랫폼 지원 (Windows PowerShell + Linux/macOS pgrep/lsof)
- ✅ **Liveness 간소화:** 타이머 기반 정리 제거, PID 기반 즉시 판단 (2초 주기)

## Known Issues
- **ESC 중단 시 Thinking 상태 유지:** 사용자가 ESC로 Claude 응답을 중단하면 Stop 훅이 발생하지 않아 아바타가 Thinking 상태에 머무름. CLI 프로세스는 살아있으므로 PID 기반 Liveness Checker로도 감지 불가.

## 프로젝트 개요

Claude Code CLI의 상태를 실시간으로 픽셀 아바타로 시각화하는 **Electron 데스크톱 앱**.
Claude CLI 훅 이벤트를 HTTP POST로 수신하고, 에이전트별 상태(Waiting/Thinking/Working/Done/Help/Error)를 스프라이트 애니메이션으로 렌더링한다.

## 기술 스택

- **런타임:** Electron 32+ / Node.js
- **언어:** JavaScript (순수 — TypeScript 없음, 프레임워크 없음)
- **렌더링:** Canvas 기반 스프라이트 애니메이션 (requestAnimationFrame)
- **대시보드:** 순수 HTML/CSS/JS (dashboard.html)
- **검증:** AJV (JSON Schema)
- **테스트:** Jest 30
- **OS:** Windows 전용 (PowerShell 명령 사용)

## 핵심 아키텍처

```
Claude CLI ──HTTP hook──▶ POST(:47821) ──main.js:processHookEvent()
                                                    │
                                    ┌────────────────┤
                                    ▼                ▼
                            AgentManager       Dashboard
                             (SSoT)           (WebSocket)
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              renderer.js   dashboard   sessionScanner
             (픽셀 아바타)   (웹 UI)    (JSONL 분석)
```

## 파일 구조 & 역할

| 파일 | 역할 | 수정 시 주의사항 |
|------|------|----------------|
| `main.js` | Electron 메인 프로세스, 훅 서버, Liveness Checker | **1300줄 이상** — 함수 단위로 정확히 수정할 것 |
| `renderer.js` | 픽셀 아바타 애니메이션, 그리드 레이아웃 | `updateAgentState()` switch 문에 새 상태 추가 시 기존 애니메이션 유지 |
| `agentManager.js` | 에이전트 상태 관리 (Single Source of Truth) | 이벤트명 변경 금지: `agent-added`, `agent-updated`, `agent-removed` |
| `sessionScanner.js` | JSONL 파싱 → 토큰/비용 보완 (60초 주기) | 비동기 I/O 필수, 메인 스레드 차단 금지 |
| `hook.js` | Claude CLI stdin → HTTP POST 브릿지 | 47줄 — 작지만 에러 시 전체 파이프라인 중단됨 |
| `sessionend_hook.js` | SessionEnd 이벤트 JSONL 직접 기록 | transcript_path에서 sessionId 파싱 |
| `dashboard-server.js` | REST API + WebSocket 대시보드 서버 | 포트 3000 |
| `dashboardAdapter.js` | AgentManager → Dashboard 포맷 변환 | STATE_MAP 변경 시 dashboard.html과 동기화 |
| `preload.js` | Electron IPC 브릿지 | 채널명 변경 시 renderer.js와 동기화 필수 |
| `errorHandler.js` | 에러 캡처 & 분류 | 에러 코드 E001~E010 체계 사용 |

## 상태 모델

에이전트의 6가지 상태와 전환 규칙:

```
SessionStart → Waiting
UserPromptSubmit → Thinking
PreToolUse (2번째부터) → Working
PostToolUse → Thinking (2.5초 idle → Done)
Stop/TaskCompleted → Done
PostToolUseFailure/Notification/PermissionRequest → Help
SubagentStart → 자식 에이전트 생성 (Working)
SubagentStop → 자식 에이전트 제거
TeammateIdle → Waiting (팀 멤버)
SessionEnd → 에이전트 제거
```

**중요:** 첫 번째 `PreToolUse`는 세션 초기화 탐색이므로 무시해야 한다 (`firstPreToolUseDone` 플래그).

## 코딩 규칙

### 반드시 지켜야 할 것

1. **IPC 채널명 변경 금지** — `agent-added`, `agent-updated`, `agent-removed`, `renderer-ready` 등은 preload.js에 하드코딩되어 있음
2. **session_id 사용** — Claude CLI 훅은 항상 `session_id` (snake_case). JSONL 내부는 `sessionId` (camelCase). 두 형식 모두 대응:
   ```javascript
   const sessionId = data.session_id || data.sessionId;
   ```
3. **Windows 경로 처리** — `transcript_path`에 `~` 포함 가능:
   ```javascript
   const resolved = filePath.startsWith('~')
     ? path.join(os.homedir(), filePath.slice(1))
     : filePath;
   ```
4. **에이전트 수 제한 없음** — 서브에이전트/팀 모드로 50개 이상도 가능. 하드 리밋 추가하지 말 것
5. **processHookEvent() 수정 시** — switch 문의 case 순서와 타이머(postToolIdleTimers) 정리 로직 유지
6. **문서 업데이트 규칙** — 개발 진행 후(새로운 기능 구현, 아키텍처 변경 등) 반드시 `CLAUDE.md`의 상단 진행 상태와 `docs/v3-architecture.md` 문서를 동기화/업데이트해야 함

### 피해야 할 것

- `fs.readFileSync`를 메인 이벤트 루프에서 큰 파일에 사용하지 말 것 (sessionScanner는 별도 주기)
- `additionalProperties: false`를 hookSchema에 설정하지 말 것 (Claude가 새 필드 추가할 수 있음)
- renderer.js에서 DOM 직접 조작 시 `requestAnimationFrame` 바깥에서 하지 말 것
- 에러 발생 시 `return null` 대신 `errorHandler.capture()` 사용

## 훅 이벤트 필드 (Claude CLI 공식)

**훅 방식: HTTP 훅** (type: "http") — Claude가 직접 localhost:47821/hook으로 POST. hook.js 프로세스 스폰 불필요.

모든 훅 이벤트의 공통 입력:
```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" }
}
```

### 이벤트별 활용 필드

| 이벤트 | 주요 필드 | 용도 |
|--------|----------|------|
| SessionStart | `source` (startup/resume/clear/compact), `model`, `agent_type` | compact 시 중복 에이전트 방지 |
| PreToolUse/PostToolUse | `tool_name` | 아바타 버블에 현재 도구 표시 |
| Notification | `notification_type` (permission_prompt/idle_prompt/auth_success) | Waiting vs Help 구분 |
| Stop/TaskCompleted | `last_assistant_message`, `task_id`, `task_subject` | 마지막 메시지 표시, 팀 작업 추적 |
| SessionEnd | `reason` | 종료 사유 로깅 |
| SubagentStart/Stop | `agent_id`, `agent_type`, `agent_transcript_path` | 서브에이전트 타입 배지 |
| TeammateIdle | `teammate_name`, `team_name` | 팀원 이름/팀명 표시 |
| PreCompact | `trigger` (manual/auto) | 컨텍스트 윈도우 건강 모니터링 |

## 테스트

```bash
npm test                    # 전체 테스트
npm run test:coverage       # 커버리지
npm test -- --testPathPattern="agentManager"  # 특정 파일
```

테스트 파일은 `__tests__/` 디렉토리. 모킹은 `__mocks__/`.

## 실행

```bash
npm install        # 의존성 설치 + 훅 자동 등록
npm start          # Electron 앱 실행
npm run dev        # 개발 모드 (DevTools 포함)
npm run dashboard  # 대시보드 서버만 (포트 3000)
```

## 자동 훅 등록

훅 등록은 **이중으로 자동화**되어 있습니다:

1. **`npm install` 시** - `install.js`가 자동 실행
2. **`npm start` 시** - 앱 시작 시 훅 등록 상태 체크, 미등록 시 자동 등록

### 동작 방식

- **설정 파일:** `~/.claude/settings.json` (Windows/Linux/macOS)
- **등록 내용:** 모든 Claude CLI 훅 이벤트에 HTTP 훅 자동 등록 (type: "http")
- **수동 등록:** 자동 등록이 실패할 경우 `~/.claude/settings.json`을 직접 수정

**수동 등록 예시:**
```json
{
  "hooks": {
    "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "http", "url": "http://localhost:47821/hook" }] }],
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "http", "url": "http://localhost:47821/hook" }] }]
  }
}
```

## 참고 문서

- `docs/v3-architecture.md` — 전체 아키텍처 설계 및 구현 로드맵
- `PRD.md` — 제품 요구사항 (Phase 1~5)

## reffer/ 폴더

Mission Control 참고 프로젝트 (Next.js + SQLite). **레퍼런스 전용 — 코드 수정하지 말 것.** 추후 삭제 예정.
